// Live exploration driver: whitespace-only QUEUE_API_TOKEN lockout verification.
// Run: deno run --allow-all docs/exploratory-testing/2026-09-11-queue/driver.ts
import { assertEquals } from "jsr:@std/assert@1.0";

async function startServer(token: string): Promise<{ child: Deno.ChildProcess; port: number; tempDir: string }> {
    const tempDir = await Deno.makeTempDir();
    const decoder = new TextDecoder();
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts"],
        cwd: ".",
        env: {
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: tempDir,
            QUEUE_API_TOKEN: token,
        },
        stdout: "piped",
        stderr: "piped",
    }).spawn();

    const stdoutReader = child.stdout.getReader();
    let port: number | null = null;
    let stdoutBuf = "";

    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Server startup timeout")), 5000);
    });

    const readPromise = (async () => {
        while (true) {
            const { done, value } = await stdoutReader.read();
            if (done) break;
            stdoutBuf += decoder.decode(value, { stream: true });
            const match = stdoutBuf.match(/Listening on (?:http:\/\/)?(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|::1):(\d+)/);
            if (match) {
                port = parseInt(match[1], 10);
                break;
            }
        }
        stdoutReader.releaseLock();
    })();

    await Promise.race([readPromise, timeout]);
    if (port === null) {
        throw new Error("Failed to extract port");
    }

    return { child, port, tempDir };
}

async function cleanup(child: Deno.ChildProcess, tempDir: string) {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    try { await child.status; } catch { /* ignore */ }
    try { await child.stdout.cancel(); } catch { /* ignore */ }
    try { await child.stderr.cancel(); } catch { /* ignore */ }
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
}

async function verifyRun(runIndex: number) {
    console.log(`--- Running verification run #${runIndex} ---`);
    const whitespaceTokens = [" ", "   ", "\t", "  \t  ", " secret ", "my-token ", " my-token"];
    for (const wsToken of whitespaceTokens) {
        const { child, port, tempDir } = await startServer(wsToken);
        try {
            // 1. /health returns 200 OK (server appears healthy)
            const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
            assertEquals(healthRes.status, 200, "Health check should succeed");
            const healthJson = await healthRes.json();
            assertEquals(healthJson.status, "ok");

            // 2. Probing protected endpoints with various authorization attempts
            const testHeaders = [
                {},
                { "Authorization": "Bearer" },
                { "Authorization": "Bearer " },
                { "Authorization": "Bearer   " },
                { "Authorization": `Bearer ${wsToken}` },
                { "Authorization": "Bearer test" },
            ];

            for (const headers of testHeaders) {
                const res = await fetch(`http://127.0.0.1:${port}/queues`, { headers });
                assertEquals(res.status, 401, `Headers ${JSON.stringify(headers)} must return 401`);
                assertEquals(res.headers.get("www-authenticate"), "Bearer");
                const body = await res.text();
                assertEquals(body, "Unauthorized");
            }

            const enqRes = await fetch(`http://127.0.0.1:${port}/enqueue/testq`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${wsToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ payload: "data" }),
            });
            assertEquals(enqRes.status, 401, "Enqueue with matching whitespace must be rejected with 401");
        } finally {
            await cleanup(child, tempDir);
        }
    }
    console.log(`Run #${runIndex} passed (all endpoints locked out as expected).`);
}

for (let i = 1; i <= 3; i++) {
    await verifyRun(i);
}
console.log("Verified across 3 clean, independent server instances.");
