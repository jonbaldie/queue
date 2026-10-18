import { assertEquals, assertNotEquals, assertStringIncludes } from "jsr:@std/assert@1.0";

// Regression coverage for #173: two `--persist` processes on one PERSIST
// directory each served the log from their own memory, so one item was
// delivered twice and a shutdown snapshot could erase the other's items.

const TOKEN = "shared-persist-token";
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

function spawnServer(persistDir: string): Deno.ChildProcess {
    return new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts", "--persist"],
        cwd: ".",
        env: { HOST: "127.0.0.1", PORT: "0", PERSIST: persistDir, QUEUE_API_TOKEN: TOKEN },
        stdout: "piped",
        stderr: "piped",
    }).spawn();
}

// Resolves with the bound port, or null with the output if the process
// exits before it starts listening.
async function waitForListen(child: Deno.ChildProcess): Promise<{ port: number | null; output: string }> {
    const decoder = new TextDecoder();
    const reader = child.stdout.getReader();
    let output = "";
    const timeoutId = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, 5000);
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return { port: null, output };
            output += decoder.decode(value, { stream: true });
            const match = output.match(/Listening on (?:http:\/\/)?127\.0\.0\.1:(\d+)/);
            if (match) return { port: parseInt(match[1], 10), output };
        }
    } finally {
        clearTimeout(timeoutId);
        reader.releaseLock();
    }
}

async function stop(child: Deno.ChildProcess): Promise<void> {
    try { await child.stdout.cancel(); } catch { /* ignore */ }
    try { await child.stderr.cancel(); } catch { /* ignore */ }
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    try { await child.status; } catch { /* ignore */ }
}

Deno.test("a second server on the same PERSIST directory refuses to start", async () => {
    const dir = await Deno.makeTempDir();
    const first = spawnServer(dir);
    let second: Deno.ChildProcess | null = null;
    try {
        const a = await waitForListen(first);
        assertNotEquals(a.port, null, `first server did not start:\n${a.output}`);
        const base = `http://127.0.0.1:${a.port}`;

        const enqueue = await fetch(`${base}/enqueue/jobs`, {
            method: "POST", headers, body: JSON.stringify({ payload: "from-a" }),
        });
        assertEquals(enqueue.status, 200);
        await enqueue.body?.cancel();

        second = spawnServer(dir);
        const b = await waitForListen(second);
        assertEquals(b.port, null, "second server bound a port on a PERSIST directory already in use");
        const status = await second.status;
        const stderr = new TextDecoder().decode((await second.stderr.getReader().read()).value ?? new Uint8Array());
        assertNotEquals(status.code, 0);
        assertStringIncludes(b.output + stderr, "already in use");

        // The first server still owns the queue and delivers the item exactly once.
        const dequeue = await fetch(`${base}/dequeue/jobs`, { headers });
        assertEquals(dequeue.status, 200);
        assertEquals(await dequeue.json(), "from-a");
    } finally {
        if (second) await stop(second);
        await stop(first);
        await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
});

Deno.test("a PERSIST directory is reusable after its server stops", async () => {
    const dir = await Deno.makeTempDir();
    const first = spawnServer(dir);
    let second: Deno.ChildProcess | null = null;
    try {
        const a = await waitForListen(first);
        assertNotEquals(a.port, null, `first server did not start:\n${a.output}`);
        const enqueue = await fetch(`http://127.0.0.1:${a.port}/enqueue/jobs`, {
            method: "POST", headers, body: JSON.stringify({ payload: "survives" }),
        });
        assertEquals(enqueue.status, 200);
        await enqueue.body?.cancel();
        // SIGKILL skips the shutdown flush; the OS must still release the lock.
        await stop(first);

        second = spawnServer(dir);
        const b = await waitForListen(second);
        assertNotEquals(b.port, null, `restart on the same directory did not start:\n${b.output}`);
        const dequeue = await fetch(`http://127.0.0.1:${b.port}/dequeue/jobs`, { headers });
        assertEquals(dequeue.status, 200);
        assertEquals(await dequeue.json(), "survives");
    } finally {
        if (second) await stop(second);
        await stop(first);
        await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
});
