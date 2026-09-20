import { assertEquals } from "jsr:@std/assert@1.0";

// Crash-durability tests for the persist.dat snapshot rewrite (issue #115).
//
// Manager.save() replaces the append log with a snapshot of the remaining
// items. It runs on every --persist startup and on every graceful shutdown.
// If the process dies part way through that rewrite, no acknowledged item may
// be lost: the old log has to stay complete on disk until the new one is
// fully written.
//
// These drive the real server binary over HTTP and kill it with a real
// SIGKILL — no mocks, no injected failures.

const TOKEN = "crash-test-token";
const ITEMS = 40;
const PAYLOAD_BYTES = 256 * 1024; // big enough for the rewrite to take real time

function freePort(): number {
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const { port } = listener.addr as Deno.NetAddr;
    listener.close();
    return port;
}

function spawn(dir: string, port: number): Deno.ChildProcess {
    return new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts", "--persist"],
        cwd: ".",
        env: {
            QUEUE_API_TOKEN: TOKEN,
            PORT: String(port),
            PERSIST: dir,
            RATE_LIMIT_REQUESTS: "100000",
        },
        stdout: "null",
        stderr: "null",
    }).spawn();
}

async function waitReady(port: number): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/health`);
            await res.body?.cancel();
            if (res.ok) return;
        } catch { /* not listening yet */ }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("server never became ready");
}

async function api(port: number, path: string, init: RequestInit = {}): Promise<[number, string]> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    });
    return [res.status, await res.text()];
}

function size(file: string): number {
    try {
        return Deno.statSync(file).size;
    } catch {
        return -1;
    }
}

function exists(path: string): boolean {
    try {
        Deno.statSync(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Wait until the snapshot rewrite is visibly under way: either persist.dat is
 * no longer the log we left behind, or a scratch file has appeared beside it.
 */
async function waitForRewrite(file: string, was: number, budgetMs: number): Promise<void> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
        if (size(file) !== was) return;
        if (exists(`${file}.tmp`)) return;
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error("snapshot rewrite never started");
}

function kill(server: Deno.ChildProcess, signal: Deno.Signal): void {
    try {
        server.kill(signal);
    } catch {
        // Already exited — nothing left to kill.
    }
}

async function buildBacklog(dir: string): Promise<number> {
    const port = freePort();
    const server = spawn(dir, port);
    await waitReady(port);
    const filler = "x".repeat(PAYLOAD_BYTES);
    let acknowledged = 0;
    for (let i = 0; i < ITEMS; i++) {
        const [status] = await api(port, "/enqueue/jobs", {
            method: "POST",
            body: JSON.stringify({ payload: `${i}:${filler}` }),
        });
        if (status === 200) acknowledged++;
    }
    assertEquals(acknowledged, ITEMS, "every enqueue should be acknowledged");
    server.kill("SIGKILL");
    await server.status;
    return acknowledged;
}

async function recoveredLength(dir: string): Promise<number> {
    const port = freePort();
    const server = spawn(dir, port);
    try {
        await waitReady(port);
        const [, body] = await api(port, "/length/jobs");
        return Number(body);
    } finally {
        kill(server, "SIGTERM");
        await server.status;
    }
}

Deno.test("persist survives SIGKILL during the startup snapshot rewrite", async () => {
    const dir = await Deno.makeTempDir({ prefix: "queue-crash-startup-" });
    const file = `${dir}/persist.dat`;
    try {
        const acknowledged = await buildBacklog(dir);
        const full = size(file);

        // Restart, then kill the instant the startup rewrite touches the log.
        const port = freePort();
        const server = spawn(dir, port);
        await waitForRewrite(file, full, 30_000);
        kill(server, "SIGKILL");
        await server.status;

        assertEquals(await recoveredLength(dir), acknowledged);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("persist survives SIGKILL during the shutdown snapshot flush", async () => {
    const dir = await Deno.makeTempDir({ prefix: "queue-crash-shutdown-" });
    const file = `${dir}/persist.dat`;
    try {
        const port = freePort();
        const server = spawn(dir, port);
        await waitReady(port);
        const filler = "x".repeat(PAYLOAD_BYTES);
        let acknowledged = 0;
        for (let i = 0; i < ITEMS; i++) {
            const [status] = await api(port, "/enqueue/jobs", {
                method: "POST",
                body: JSON.stringify({ payload: `${i}:${filler}` }),
            });
            if (status === 200) acknowledged++;
        }
        assertEquals(acknowledged, ITEMS);
        const full = size(file);

        // Ask for a graceful shutdown, then kill it mid-flush.
        server.kill("SIGTERM");
        await waitForRewrite(file, full, 30_000);
        kill(server, "SIGKILL");
        await server.status;

        assertEquals(await recoveredLength(dir), acknowledged);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
