// Regression coverage for the class of bug where `deno compile` permission
// flags don't match what main.ts actually needs at runtime. No other CI job
// executes the compiled artifact (the "test" job compiles it but then runs
// `deno test`; mutation/quality jobs use `deno run`), so a broken binary can
// ship green without these tests.
//
// Each test isolates one permission dimension by leaving the others
// unrestricted, mirroring how each bug was originally diagnosed.

import { assertEquals } from "jsr:@std/assert@1.0";

async function compile(permFlags: string[], outPath: string): Promise<void> {
    const cmd = new Deno.Command(Deno.execPath(), {
        args: ["compile", ...permFlags, "-o", outPath, "main.ts"],
        cwd: ".",
        stdout: "piped",
        stderr: "piped",
    });
    const { code, stderr } = await cmd.output();
    if (code !== 0) {
        throw new Error(`compile failed: ${new TextDecoder().decode(stderr)}`);
    }
}

// Spawns a compiled binary and waits for it to either announce it's
// listening, or exit/crash. Returns the outcome so callers can assert on it.
async function probeStartup(
    binPath: string,
    args: string[],
    env: Record<string, string>,
): Promise<{ started: boolean; output: string }> {
    const decoder = new TextDecoder();
    const child = new Deno.Command(binPath, {
        args,
        env,
        stdout: "piped",
        stderr: "piped",
    }).spawn();

    let buf = "";
    let started = false;

    const stdoutReader = child.stdout.getReader();
    const stderrReader = child.stderr.getReader();

    const readAll = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            if (buf.includes("Listening on")) {
                started = true;
                return;
            }
        }
    };

    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));

    await Promise.race([
        Promise.all([readAll(stdoutReader), readAll(stderrReader)]),
        timeout,
    ]);

    try { stdoutReader.releaseLock(); } catch { /* ignore */ }
    try { stderrReader.releaseLock(); } catch { /* ignore */ }
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    try { await child.status; } catch { /* ignore */ }

    return { started, output: buf };
}

Deno.test({
    name: "compiled binary: starts with a scoped --allow-env allowlist (#64)",
    fn: async () => {
        const tempDir = await Deno.makeTempDir({ prefix: "queue-compile-test-" });
        const outPath = `${tempDir}/queue`;
        try {
            await compile(
                [
                    "--allow-read",
                    "--allow-write",
                    "--allow-net",
                    "--allow-env=HOST,PORT,PERSIST,QUEUE_API_TOKEN,QUEUE_DEPTH_LIMIT,QUEUE_COUNT_LIMIT,RATE_LIMIT_REQUESTS",
                    "--allow-sys",
                ],
                outPath,
            );
            const { started, output } = await probeStartup(outPath, [], {
                QUEUE_API_TOKEN: "compile-test-token",
                HOST: "127.0.0.1",
                PORT: "0",
            });
            assertEquals(started, true, `binary did not report listening. Output:\n${output}`);
        } finally {
            await Deno.remove(tempDir, { recursive: true }).catch(() => {});
        }
    },
    // Compiling a 100MB+ binary is slow; this is an integration test, not a unit test.
    sanitizeResources: false,
    sanitizeOps: false,
});

Deno.test({
    name: "compiled binary: starts and persists with an arbitrary --persist dir (#65)",
    fn: async () => {
        const tempDir = await Deno.makeTempDir({ prefix: "queue-compile-test-" });
        const outPath = `${tempDir}/queue`;
        const persistDir = `${tempDir}/persist`;
        try {
            await compile(
                [
                    "--allow-read",
                    "--allow-write",
                    "--allow-net",
                    "--allow-env",
                    "--allow-sys",
                ],
                outPath,
            );
            const { started, output } = await probeStartup(outPath, ["--persist"], {
                QUEUE_API_TOKEN: "compile-test-token",
                HOST: "127.0.0.1",
                PORT: "0",
                PERSIST: persistDir,
            });
            assertEquals(started, true, `binary did not report listening. Output:\n${output}`);
        } finally {
            await Deno.remove(tempDir, { recursive: true }).catch(() => {});
        }
    },
    // Compiling a 100MB+ binary is slow; this is an integration test, not a unit test.
    sanitizeResources: false,
    sanitizeOps: false,
});
