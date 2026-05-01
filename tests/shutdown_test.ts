import { assertEquals } from "jsr:@std/assert@1.0";
import * as Persistency from "../src/persist.ts";
import QueueManager from "../src/manager.ts";

Deno.test("manager save flushes all queues to persist", () => {
    const persist = new Persistency.File;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q1", "a");
    mgr.enqueue("q1", "b");
    mgr.enqueue("q2", "c");

    mgr.save();

    const lines = persist.load().split("\n").filter((line: string) => line.length);
    assertEquals(3, lines.length);

    const parsed = lines.map((l: string) => JSON.parse(l));
    assertEquals(parsed.every((p: Record<string, unknown>) => p.enqueue === true), true);
    assertEquals(parsed.filter((p: Record<string, unknown>) => p.queue === "q1").length, 2);
    assertEquals(parsed.filter((p: Record<string, unknown>) => p.queue === "q2").length, 1);
});

Deno.test("manager save overwrites previous persist data", () => {
    const persist = new Persistency.File;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q1", "a");
    mgr.save();

    mgr.enqueue("q1", "b");
    mgr.save();

    const lines = persist.load().split("\n").filter((line: string) => line.length);
    assertEquals(2, lines.length);
});

Deno.test("manager save with empty queues writes nothing", () => {
    const persist = new Persistency.File;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.save();

    assertEquals(persist.load(), "");
});

Deno.test("manager save preserves queue order", () => {
    const persist = new Persistency.File;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q", "first");
    mgr.enqueue("q", "second");
    mgr.enqueue("q", "third");

    mgr.save();

    const lines = persist.load().split("\n").filter((line: string) => line.length);
    const payloads = lines.map((l: string) => JSON.parse(l).payload);
    assertEquals(payloads, ["first", "second", "third"]);
});

Deno.test("manager save then load round-trips data", () => {
    const persist = new Persistency.File;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("x", "one");
    mgr.enqueue("x", "two");
    mgr.enqueue("y", "three");

    mgr.save();

    const mgr2 = new QueueManager(persist);
    mgr2.load();

    assertEquals(mgr2.length("x"), 2);
    assertEquals(mgr2.length("y"), 1);
    assertEquals(mgr2.dequeue("x"), "one");
    assertEquals(mgr2.dequeue("x"), "two");
    assertEquals(mgr2.dequeue("y"), "three");
});

async function startServer(env: Record<string, string>): Promise<{ child: Deno.ChildProcess; port: number }> {
    const decoder = new TextDecoder();
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts", "--persist"],
        cwd: ".",
        env,
        stdout: "piped",
        stderr: "piped",
    }).spawn();

    const stdoutReader = child.stdout.getReader();
    let port: number | null = null;
    let stdoutBuf = "";

    let timeoutId: number;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Server startup timeout")), 5000);
    });

    const readPromise = (async () => {
        while (true) {
            const { done, value } = await stdoutReader.read();
            if (done) break;
            stdoutBuf += decoder.decode(value, { stream: true });
            const match = stdoutBuf.match(/Listening on (?:127\.0\.0\.1|localhost):(\d+)/);
            if (match) {
                port = parseInt(match[1], 10);
                break;
            }
        }
        stdoutReader.releaseLock();
    })();

    await Promise.race([readPromise, timeout]);
    clearTimeout(timeoutId!);

    if (port === null) {
        const stderr = await child.stderr.getReader().read();
        const errText = stderr.value ? decoder.decode(stderr.value) : "";
        throw new Error(`Server did not start. stdout: ${stdoutBuf}\nstderr: ${errText}`);
    }

    return { child, port };
}

async function cleanupChild(child: Deno.ChildProcess) {
    try { await child.stdout.cancel(); } catch { /* ignore */ }
    try { await child.stderr.cancel(); } catch { /* ignore */ }
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    try { await child.status; } catch { /* ignore */ }
}

Deno.test("server starts, accepts requests, and shuts down gracefully on SIGTERM", async () => {
    const tempDir = await Deno.makeTempDir();
    const persistFile = tempDir + "/persist.dat";

    const { child, port } = await startServer({
        HOST: "127.0.0.1",
        PORT: "0",
        PERSIST: tempDir,
        QUEUE_API_TOKEN: "shutdown-test-token",
    });

    try {
        const enqueueRes = await fetch(`http://127.0.0.1:${port}/enqueue/shutdown-test`, {
            method: "POST",
            headers: {
                "Authorization": "Bearer shutdown-test-token",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ payload: "survive-shutdown" }),
        });
        assertEquals(enqueueRes.status, 200);
        await enqueueRes.text();

        child.kill("SIGTERM");

        const exitStatus = await child.status;
        assertEquals(exitStatus.code, 0);

        const persistContent = new TextDecoder().decode(await Deno.readFile(persistFile));
        assertEquals(persistContent.includes("survive-shutdown"), true);
        assertEquals(persistContent.includes("shutdown-test"), true);
    } finally {
        await cleanupChild(child);
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});

Deno.test("server shuts down gracefully on SIGINT", async () => {
    const tempDir = await Deno.makeTempDir();

    const { child, port } = await startServer({
        HOST: "127.0.0.1",
        PORT: "0",
        PERSIST: tempDir,
        QUEUE_API_TOKEN: "shutdown-test-token",
    });

    try {
        const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
        assertEquals(healthRes.status, 200);
        await healthRes.text();

        child.kill("SIGINT");

        const exitStatus = await child.status;
        assertEquals(exitStatus.code, 0);
    } finally {
        await cleanupChild(child);
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});
