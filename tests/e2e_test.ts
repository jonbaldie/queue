import { assertEquals, assertNotEquals, assertThrows, assertRejects } from "jsr:@std/assert@1.0";
import QueueManager, { QueueNameTooLongError } from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";
import * as Persistency from "../src/persist.ts";
import { RateLimiter } from "../src/rate_limiter.ts";
import { parseConfig, ConfigError } from "../src/config.ts";

// Shared helpers
const API_TOKEN = "test-token";
const authHeaders = { "Authorization": `Bearer ${API_TOKEN}` };

function makeHandler(token = API_TOKEN, rateLimit = 100) {
    const mgr = new QueueManager(new Persistency.MemoryStore());
    return createHandler(mgr, token, rateLimit);
}

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
            const match = stdoutBuf.match(/Listening on (?:http:\/\/)?(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)/);
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
        throw new Error(`Server did not start. stdout: ${stdoutBuf}
stderr: ${errText}`);
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

Deno.test("server starts and ignores a null persistence record", async () => {
    const tempDir = await Deno.makeTempDir();
    const token = "malformed-persist-test-token";

    try {
        await Deno.writeTextFile(tempDir + "/persist.dat", "null");
        const { child, port } = await startServer({
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: tempDir,
            QUEUE_API_TOKEN: token,
        });

        try {
            const health = await fetch(`http://127.0.0.1:${port}/health`);
            assertEquals(health.status, 200);
            await health.body?.cancel();

            const queues = await fetch(`http://127.0.0.1:${port}/queues`, {
                headers: { "Authorization": `Bearer ${token}` },
            });
            assertEquals(queues.status, 200);
            assertEquals(await queues.json(), []);
        } finally {
            await cleanupChild(child);
        }
    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});
