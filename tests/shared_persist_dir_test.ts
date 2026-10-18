// Regression coverage for #173: a second server pointed at the same PERSIST
// directory served the same queue from its own memory, so one item was
// delivered twice and the first server's shutdown snapshot erased items the
// second server had acknowledged.

import { assertEquals } from "jsr:@std/assert@1.0";

const TOKEN = "shared-dir-token";
const headers = { Authorization: `Bearer ${TOKEN}` };

interface Server {
    child: Deno.ChildProcess;
    output: () => string;
    // Resolves with the port once the server logs that it is listening.
    listening: Promise<number>;
}

function spawnServer(persistDir: string): Server {
    const decoder = new TextDecoder();
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts", "--persist"],
        cwd: ".",
        env: { HOST: "127.0.0.1", PORT: "0", PERSIST: persistDir, QUEUE_API_TOKEN: TOKEN },
        stdout: "piped",
        stderr: "piped",
    }).spawn();

    let buf = "";
    let notifyListening: (port: number) => void;
    const listening = new Promise<number>((resolve) => notifyListening = resolve);
    const drain = async (stream: ReadableStream<Uint8Array>) => {
        for await (const chunk of stream) {
            buf += decoder.decode(chunk, { stream: true });
            const match = buf.match(/Listening on (?:http:\/\/)?127\.0\.0\.1:(\d+)/);
            if (match) notifyListening!(parseInt(match[1], 10));
        }
    };
    drain(child.stdout).catch(() => {});
    drain(child.stderr).catch(() => {});
    return { child, output: () => buf, listening };
}

// Resolves with the first of: the port it listens on, "waiting" once it logs
// that another server holds the directory, or "exited".
async function startupOutcome(server: Server): Promise<number | "waiting" | "exited"> {
    let intervalId: number;
    const waiting = new Promise<"waiting">((resolve) => {
        intervalId = setInterval(() => {
            if (server.output().includes("Waiting for another server")) resolve("waiting");
        }, 10);
    });
    let timeoutId: number;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`no startup outcome:\n${server.output()}`)), 5000);
    });
    try {
        return await Promise.race([
            server.listening,
            waiting,
            server.child.status.then(() => "exited" as const),
            timeout,
        ]);
    } finally {
        clearInterval(intervalId!);
        clearTimeout(timeoutId!);
    }
}

async function stop(server: Server, signal: Deno.Signal): Promise<Deno.CommandStatus> {
    try { server.child.kill(signal); } catch { /* already exited */ }
    return await server.child.status;
}

async function enqueue(port: number, payload: string): Promise<number> {
    const res = await fetch(`http://127.0.0.1:${port}/enqueue/jobs`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
    });
    await res.body?.cancel();
    return res.status;
}

async function dequeue(port: number): Promise<unknown> {
    const res = await fetch(`http://127.0.0.1:${port}/dequeue/jobs`, { headers });
    if (res.status === 204) return null;
    return await res.json();
}

Deno.test({
    name: "a second server on the same PERSIST dir waits for the first to exit, then takes over its items (#173)",
    fn: async () => {
        const persistDir = await Deno.makeTempDir({ prefix: "queue-shared-dir-" });
        const servers: Server[] = [];
        try {
            const first = spawnServer(persistDir);
            servers.push(first);
            const firstPort = await startupOutcome(first);
            if (typeof firstPort !== "number") throw new Error(`first server did not start:\n${first.output()}`);
            assertEquals(await enqueue(firstPort, "from-a"), 200);
            assertEquals(await enqueue(firstPort, "from-a2"), 200);

            // Rolling replace: start the new server before stopping the old one.
            const second = spawnServer(persistDir);
            servers.push(second);
            assertEquals(await startupOutcome(second), "waiting", second.output());
            assertEquals(await dequeue(firstPort), "from-a");

            assertEquals((await stop(first, "SIGTERM")).code, 0, first.output());
            const secondPort = await second.listening;
            assertEquals(await dequeue(secondPort), "from-a2", "the old server's state must be handed over");
            assertEquals(await enqueue(secondPort, "from-b"), 200);

            // Killed before it can flush: its acknowledged item is only in the log.
            await stop(second, "SIGKILL");

            const restarted = spawnServer(persistDir);
            servers.push(restarted);
            const restartedPort = await startupOutcome(restarted);
            if (typeof restartedPort !== "number") throw new Error(`restart did not start:\n${restarted.output()}`);
            assertEquals(await dequeue(restartedPort), "from-b");
            assertEquals(await dequeue(restartedPort), null);
        } finally {
            for (const server of servers) await stop(server, "SIGKILL");
            await Deno.remove(persistDir, { recursive: true }).catch(() => {});
        }
    },
    sanitizeResources: false,
    sanitizeOps: false,
});
