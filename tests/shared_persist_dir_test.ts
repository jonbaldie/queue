import { assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1.0";

// Two server processes on one PERSIST directory each serve the queue from
// their own memory, so the same item is delivered twice and one server's
// shutdown snapshot erases the other's acknowledged items (issue #173).

const TOKEN = "shared-dir-token";
const headers = { Authorization: `Bearer ${TOKEN}` };

function spawnServer(persistDir: string): Deno.ChildProcess {
    return new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts", "--persist"],
        env: { QUEUE_API_TOKEN: TOKEN, HOST: "127.0.0.1", PORT: "0", PERSIST: persistDir },
        stdout: "piped",
        stderr: "piped",
    }).spawn();
}

// Resolves with the listening port, or null if the process exits first.
async function waitForListen(child: Deno.ChildProcess): Promise<{ port: number | null; output: string }> {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const deadline = setTimeout(() => child.kill("SIGKILL"), 10000);
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return { port: null, output };
            output += decoder.decode(value, { stream: true });
            const match = output.match(/Listening on [^:]+:(\d+)/);
            if (match) return { port: Number(match[1]), output };
        }
    } finally {
        clearTimeout(deadline);
        reader.releaseLock();
    }
}

async function stop(child: Deno.ChildProcess, signal: Deno.Signal): Promise<Deno.CommandStatus> {
    try { child.kill(signal); } catch { /* already exited */ }
    const status = await child.status;
    try { await child.stdout.cancel(); } catch { /* already consumed */ }
    try { await child.stderr.cancel(); } catch { /* already consumed */ }
    return status;
}

async function request(port: number, method: string, path: string, body?: unknown): Promise<Response> {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { ...headers, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

Deno.test("a second server on the same PERSIST directory refuses to start and the first keeps delivering each item once", async () => {
    const persistDir = Deno.makeTempDirSync() + "/";
    const first = spawnServer(persistDir);
    let second: Deno.ChildProcess | null = null;
    try {
        const firstListen = await waitForListen(first);
        assertNotEquals(firstListen.port, null, firstListen.output);
        const firstPort = firstListen.port!;

        const enqueue = await request(firstPort, "POST", "/enqueue/jobs", { payload: "from-a" });
        assertEquals(enqueue.status, 200);
        await enqueue.body?.cancel();

        second = spawnServer(persistDir);
        const secondListen = await waitForListen(second);
        if (secondListen.port !== null) {
            // The bug: the second server is live on the same directory.
            const fromFirst = await request(firstPort, "GET", "/dequeue/jobs");
            const fromSecond = await request(secondListen.port, "GET", "/dequeue/jobs");
            const delivered = [await fromFirst.text(), await fromSecond.text()];
            throw new Error(`second server started on a locked PERSIST directory; dequeues returned ${JSON.stringify(delivered)}`);
        }
        const secondStatus = await second.status;
        const secondStderr = await new Response(second.stderr).text();
        second = null;
        assertNotEquals(secondStatus.code, 0);
        assertMatch(secondStderr + secondListen.output, /already in use/);

        const dequeue = await request(firstPort, "GET", "/dequeue/jobs");
        assertEquals(await dequeue.json(), "from-a");
        const empty = await request(firstPort, "GET", "/dequeue/jobs");
        assertEquals(empty.status, 204);
        await empty.body?.cancel();
    } finally {
        if (second !== null) await stop(second, "SIGKILL");
        await stop(first, "SIGKILL");
        Deno.removeSync(persistDir, { recursive: true });
    }
});

Deno.test("the PERSIST directory is released when the owning server exits, including on SIGKILL", async () => {
    const persistDir = Deno.makeTempDirSync() + "/";
    try {
        const first = spawnServer(persistDir);
        const firstListen = await waitForListen(first);
        assertNotEquals(firstListen.port, null, firstListen.output);
        const enqueue = await request(firstListen.port!, "POST", "/enqueue/jobs", { payload: "survives" });
        assertEquals(enqueue.status, 200);
        await enqueue.body?.cancel();
        await stop(first, "SIGKILL");

        const restarted = spawnServer(persistDir);
        try {
            const restartedListen = await waitForListen(restarted);
            assertNotEquals(restartedListen.port, null, restartedListen.output);
            const dequeue = await request(restartedListen.port!, "GET", "/dequeue/jobs");
            assertEquals(await dequeue.json(), "survives");
        } finally {
            await stop(restarted, "SIGKILL");
        }
    } finally {
        Deno.removeSync(persistDir, { recursive: true });
    }
});
