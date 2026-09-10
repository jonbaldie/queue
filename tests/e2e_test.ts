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

async function assertDoesNotBind(env: Record<string, string>): Promise<string> {
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts"],
        cwd: ".",
        env,
        stdout: "piped",
        stderr: "piped",
    }).spawn();

    const timeoutId = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, 3000);

    const { code, stdout, stderr } = await child.output();
    clearTimeout(timeoutId);

    const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
    assertEquals(output.includes("Listening on"), false, `server bound a port. Output:\n${output}`);
    assertNotEquals(code, 0);
    return output;
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

Deno.test("e2e: HEAD requests to GET endpoints return 200 with empty body (RFC 9110)", async () => {
    const tempDir = await Deno.makeTempDir();
    const token = "head-e2e-test-token";

    try {
        const { child, port } = await startServer({
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: tempDir,
            QUEUE_API_TOKEN: token,
        });

        try {
            // HEAD /health
            const healthRes = await fetch(`http://127.0.0.1:${port}/health`, { method: "HEAD" });
            assertEquals(healthRes.status, 200);
            assertEquals(healthRes.headers.get("content-type"), "application/json");
            const healthBody = await healthRes.text();
            assertEquals(healthBody, "");

            // HEAD /queues (authenticated)
            const queuesRes = await fetch(`http://127.0.0.1:${port}/queues`, {
                method: "HEAD",
                headers: { "Authorization": `Bearer ${token}` },
            });
            assertEquals(queuesRes.status, 200);
            assertEquals(queuesRes.headers.get("content-type"), "application/json");
            const queuesBody = await queuesRes.text();
            assertEquals(queuesBody, "");

            // HEAD /enqueue/:queue returns 405 Method Not Allowed
            const enqueueRes = await fetch(`http://127.0.0.1:${port}/enqueue/q`, {
                method: "HEAD",
                headers: { "Authorization": `Bearer ${token}` },
            });
            assertEquals(enqueueRes.status, 405);
            assertEquals(enqueueRes.headers.get("allow"), "POST");
            await enqueueRes.body?.cancel();
        } finally {
            await cleanupChild(child);
        }
    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});

Deno.test("e2e: 405 responses include required Allow header (RFC 9110 §15.5.6)", async () => {
    const tempDir = await Deno.makeTempDir();
    const token = "allow-e2e-token";

    try {
        const { child, port } = await startServer({
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: tempDir,
            QUEUE_API_TOKEN: token,
        });

        try {
            // POST /queues returns 405 with Allow: GET
            const queuesRes = await fetch(`http://127.0.0.1:${port}/queues`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` },
            });
            assertEquals(queuesRes.status, 405);
            assertEquals(queuesRes.headers.get("allow"), "GET");
            await queuesRes.body?.cancel();

            // GET /enqueue/q returns 405 with Allow: POST
            const enqueueRes = await fetch(`http://127.0.0.1:${port}/enqueue/q`, {
                method: "GET",
                headers: { "Authorization": `Bearer ${token}` },
            });
            assertEquals(enqueueRes.status, 405);
            assertEquals(enqueueRes.headers.get("allow"), "POST");
            await enqueueRes.body?.cancel();

            // POST /health returns 405 with Allow: GET (unauthenticated)
            const healthRes = await fetch(`http://127.0.0.1:${port}/health`, {
                method: "POST",
            });
            assertEquals(healthRes.status, 405);
            assertEquals(healthRes.headers.get("allow"), "GET");
            await healthRes.body?.cancel();

            // POST /nonexistent returns 404 with no Allow header
            const notFoundRes = await fetch(`http://127.0.0.1:${port}/nonexistent`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` },
            });
            assertEquals(notFoundRes.status, 404);
            assertEquals(notFoundRes.headers.get("allow"), null);
            await notFoundRes.body?.cancel();
        } finally {
            await cleanupChild(child);
        }
    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});

Deno.test("e2e: 401 responses include required Bearer challenge (RFC 9110 §15.5.2)", async () => {
    const tempDir = await Deno.makeTempDir();

    try {
        const { child, port } = await startServer({
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: tempDir,
            QUEUE_API_TOKEN: "auth-challenge-test-token",
        });

        try {
            const response = await fetch(`http://127.0.0.1:${port}/length/protected`);
            assertEquals(response.status, 401);
            assertEquals(response.headers.get("www-authenticate"), "Bearer");
            assertEquals(await response.text(), "Unauthorized");
        } finally {
            await cleanupChild(child);
        }
    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});

Deno.test("e2e: missing QUEUE_API_TOKEN fails before the server binds a port", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
        const output = await assertDoesNotBind({
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: tempDir,
        });
        assertEquals(output.includes("QUEUE_API_TOKEN must be a non-empty string"), true);
    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});

Deno.test("e2e: empty QUEUE_API_TOKEN fails before the server binds a port", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
        const output = await assertDoesNotBind({
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: tempDir,
            QUEUE_API_TOKEN: "",
        });
        assertEquals(output.includes("QUEUE_API_TOKEN must be a non-empty string"), true);
    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});

Deno.test("e2e: Bearer tokens with multiple spaces and tabs authenticate (RFC 9110 §11.1)", async () => {
    const tempDir = await Deno.makeTempDir();
    const token = "auth-whitespace-token";

    try {
        const { child, port } = await startServer({
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: tempDir,
            QUEUE_API_TOKEN: token,
        });

        try {
            // Single space
            const singleRes = await fetch(`http://127.0.0.1:${port}/queues`, {
                headers: { "Authorization": `Bearer ${token}` },
            });
            assertEquals(singleRes.status, 200);
            await singleRes.body?.cancel();

            // Multiple spaces
            const multiRes = await fetch(`http://127.0.0.1:${port}/queues`, {
                headers: { "Authorization": `Bearer   ${token}` },
            });
            assertEquals(multiRes.status, 200);
            await multiRes.body?.cancel();

            // Tab delimiter
            const tabRes = await fetch(`http://127.0.0.1:${port}/queues`, {
                headers: { "Authorization": `Bearer\t${token}` },
            });
            assertEquals(tabRes.status, 200);
            await tabRes.body?.cancel();
        } finally {
            await cleanupChild(child);
        }
    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});

Deno.test("e2e: URI-equivalent percent-encodings address the same queue and malformed names return 400", async () => {
    const tempDir = await Deno.makeTempDir();
    const token = "percent-encoding-test-token";

    try {
        const { child, port } = await startServer({
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: tempDir,
            QUEUE_API_TOKEN: token,
        });

        try {
            const auth = { "Authorization": `Bearer ${token}` };

            // Enqueue via uppercase %C3%BC
            const enq1 = await fetch(`http://127.0.0.1:${port}/enqueue/%C3%BC`, {
                method: "POST",
                headers: { ...auth, "Content-Type": "application/json" },
                body: JSON.stringify({ payload: "first-e2e" }),
            });
            assertEquals(enq1.status, 200);
            await enq1.body?.cancel();

            // Enqueue via lowercase %c3%bc
            const enq2 = await fetch(`http://127.0.0.1:${port}/enqueue/%c3%bc`, {
                method: "POST",
                headers: { ...auth, "Content-Type": "application/json" },
                body: JSON.stringify({ payload: "second-e2e" }),
            });
            assertEquals(enq2.status, 200);
            await enq2.body?.cancel();

            // GET /queues returns one canonical decoded name "ü"
            const listRes = await fetch(`http://127.0.0.1:${port}/queues`, { headers: auth });
            assertEquals(listRes.status, 200);
            assertEquals(await listRes.json(), ["ü"]);

            // /length via encoded name
            const lenRes = await fetch(`http://127.0.0.1:${port}/length/%C3%BC`, { headers: auth });
            assertEquals(lenRes.status, 200);
            assertEquals(await lenRes.text(), "2");

            // /peek via lowercase encoded name
            const peekRes = await fetch(`http://127.0.0.1:${port}/peek/%c3%bc`, { headers: auth });
            assertEquals(peekRes.status, 200);
            assertEquals(await peekRes.json(), "first-e2e");

            // /dequeue via encoded names in FIFO order
            const deq1 = await fetch(`http://127.0.0.1:${port}/dequeue/%c3%bc`, { headers: auth });
            assertEquals(deq1.status, 200);
            assertEquals(await deq1.json(), "first-e2e");

            const deq2 = await fetch(`http://127.0.0.1:${port}/dequeue/%C3%BC`, { headers: auth });
            assertEquals(deq2.status, 200);
            assertEquals(await deq2.json(), "second-e2e");

            // Malformed percent encoding returns 400 and creates no queues
            const badEnq = await fetch(`http://127.0.0.1:${port}/enqueue/%ZZ`, {
                method: "POST",
                headers: { ...auth, "Content-Type": "application/json" },
                body: JSON.stringify({ payload: "bad" }),
            });
            assertEquals(badEnq.status, 400);
            await badEnq.body?.cancel();

            const emptyListRes = await fetch(`http://127.0.0.1:${port}/queues`, { headers: auth });
            assertEquals(emptyListRes.status, 200);
            assertEquals(await emptyListRes.json(), []);
        } finally {
            await cleanupChild(child);
        }
    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});

