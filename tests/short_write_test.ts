import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0";

// Regression tests for #160: short writes to persist.dat on a full PERSIST
// volume. `ulimit -f` caps the size of any file the server writes, which
// makes the kernel perform a real short write (then fail with EFBIG) exactly
// as a full disk does, without needing root to mount a tiny volume.
// SIGXFSZ is ignored so the write fails instead of killing the process.

const TOKEN = "short-write-token";
const AUTH = { "Authorization": `Bearer ${TOKEN}` };
// 100 blocks is 50-100 KiB depending on the shell's block size; either way
// it is far below LARGE_PAYLOAD and far above the small items.
const FILE_SIZE_LIMIT_BLOCKS = 100;
const LARGE_PAYLOAD = "x".repeat(200 * 1024);

function serverCommand(persistDir: string, limitFileSize: boolean): Deno.Command {
    const env = { HOST: "127.0.0.1", PORT: "0", PERSIST: persistDir, QUEUE_API_TOKEN: TOKEN };
    if (!limitFileSize) {
        return new Deno.Command(Deno.execPath(), {
            args: ["run", "--allow-all", "main.ts", "--persist"],
            env,
            stdout: "piped",
            stderr: "piped",
        });
    }
    return new Deno.Command("sh", {
        args: [
            "-c",
            `trap '' XFSZ; ulimit -f ${FILE_SIZE_LIMIT_BLOCKS}; exec "$0" run --allow-all main.ts --persist`,
            Deno.execPath(),
        ],
        env,
        stdout: "piped",
        stderr: "piped",
    });
}

async function startServer(persistDir: string, limitFileSize: boolean): Promise<{ child: Deno.ChildProcess; port: number }> {
    const child = serverCommand(persistDir, limitFileSize).spawn();
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
        const match = output.match(/Listening on (?:http:\/\/)?127\.0\.0\.1:(\d+)/);
        if (match) {
            reader.releaseLock();
            return { child, port: parseInt(match[1], 10) };
        }
    }
    reader.releaseLock();
    await stopServer(child);
    throw new Error(`Server did not start. stdout: ${output}`);
}

async function stopServer(child: Deno.ChildProcess): Promise<void> {
    try { await child.stdout.cancel(); } catch { /* ignore */ }
    try { await child.stderr.cancel(); } catch { /* ignore */ }
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    try { await child.status; } catch { /* ignore */ }
}

async function enqueue(port: number, queue: string, payload: string): Promise<number> {
    const res = await fetch(`http://127.0.0.1:${port}/enqueue/${queue}`, {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
    });
    await res.text();
    return res.status;
}

async function length(port: number, queue: string): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}/length/${queue}`, { headers: AUTH });
    return await res.text();
}

async function drain(port: number, queue: string): Promise<unknown[]> {
    const items: unknown[] = [];
    while (true) {
        const res = await fetch(`http://127.0.0.1:${port}/dequeue/${queue}`, { headers: AUTH });
        if (res.status === 204) {
            await res.body?.cancel();
            return items;
        }
        assertEquals(res.status, 200);
        items.push(await res.json());
    }
}

function logLine(queue: string, payload: string): string {
    return JSON.stringify({ queue, payload, enqueue: true, dequeue: false }) + "\n";
}

Deno.test("e2e: an enqueue that cannot be fully logged is rejected and does not corrupt later items (#160)", async () => {
    const tempDir = await Deno.makeTempDir();
    let limited: Deno.ChildProcess | undefined;
    let recovered: Deno.ChildProcess | undefined;
    try {
        const started = await startServer(tempDir, true);
        limited = started.child;
        assertEquals(await enqueue(started.port, "q", "before-full"), 200);
        assertNotEquals(await enqueue(started.port, "q", LARGE_PAYLOAD), 200);
        assertEquals(await enqueue(started.port, "q", "after-full"), 200);
        assertEquals(await length(started.port, "q"), "2");
        limited.kill("SIGKILL");
        await limited.status;

        const restarted = await startServer(tempDir, false);
        recovered = restarted.child;
        assertEquals(await drain(restarted.port, "q"), ["before-full", "after-full"]);
    } finally {
        if (limited) await stopServer(limited);
        if (recovered) await stopServer(recovered);
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});

Deno.test("e2e: a snapshot that cannot be fully written keeps the complete persist.dat (#160)", async () => {
    const tempDir = await Deno.makeTempDir();
    const persistFile = `${tempDir}/persist.dat`;
    const original = logLine("q", "small-1") + logLine("q", LARGE_PAYLOAD);
    await Deno.writeTextFile(persistFile, original);
    let recovered: Deno.ChildProcess | undefined;
    try {
        // Startup compacts the log via the same snapshot path as SIGTERM.
        // The snapshot cannot fit under the file size limit.
        const child = serverCommand(tempDir, true).spawn();
        const timeoutId = setTimeout(() => child.kill("SIGKILL"), 10000);
        const { code, stdout } = await child.output();
        clearTimeout(timeoutId);
        const output = new TextDecoder().decode(stdout);
        assertEquals(output.includes("Listening on"), false, `server started without a complete snapshot:\n${output}`);
        assertNotEquals(code, 0);
        assertEquals(await Deno.readTextFile(persistFile), original);

        const restarted = await startServer(tempDir, false);
        recovered = restarted.child;
        assertEquals(await drain(restarted.port, "q"), ["small-1", LARGE_PAYLOAD]);
    } finally {
        if (recovered) await stopServer(recovered);
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});

async function dequeue(port: number, queue: string): Promise<{ status: number; body: string }> {
    const res = await fetch(`http://127.0.0.1:${port}/dequeue/${queue}`, { headers: AUTH });
    return { status: res.status, body: await res.text() };
}

// Byte cap of `ulimit -f` on this host. The unit is 512 bytes on Linux and
// 1024 on macOS, so measure it instead of assuming.
async function fileSizeCap(dir: string): Promise<number> {
    const probeFile = `${dir}/cap-probe.ts`;
    const probeData = `${dir}/cap-probe.dat`;
    await Deno.writeTextFile(
        probeFile,
        `
const path = Deno.args[0];
let lo = 0;
let hi = 2_000_000;
while (lo < hi) {
  const mid = Math.ceil((lo + hi) / 2);
  try {
    Deno.writeFileSync(path, new Uint8Array(mid));
    lo = mid;
  } catch {
    hi = mid - 1;
  }
}
console.log(lo);
`,
    );
    const child = new Deno.Command("sh", {
        args: [
            "-c",
            `trap '' XFSZ; ulimit -f ${FILE_SIZE_LIMIT_BLOCKS}; exec "$0" run --allow-write "$1" "$2"`,
            Deno.execPath(),
            probeFile,
            probeData,
        ],
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    try {
        const stdout = await new Response(child.stdout).text();
        const stderr = await new Response(child.stderr).text();
        const status = await child.status;
        if (!status.success) {
            throw new Error(stderr);
        }
        return Number(stdout.trim());
    } finally {
        await child.stdout.cancel().catch(() => {});
        await child.stderr.cancel().catch(() => {});
    }
}

Deno.test("e2e: a failed persist write leaves the queue unchanged (#161)", async () => {
    const tempDir = await Deno.makeTempDir();
    const cap = await fileSizeCap(tempDir);
    const overhead = logLine("q", "").length;
    const payload = "x".repeat(cap - overhead);
    // The accepted item fills persist.dat to the cap, so the dequeue event
    // (the same number of bytes) cannot be written. That is the minimised
    // full-volume failure: the log write throws, the client sees 500.
    assertEquals(logLine("q", payload).length, cap);

    let limited: Deno.ChildProcess | undefined;
    let recovered: Deno.ChildProcess | undefined;
    try {
        const started = await startServer(tempDir, true);
        limited = started.child;
        assertEquals(await enqueue(started.port, "q", payload), 200);
        assertEquals(await length(started.port, "q"), "1");

        const failedDequeue = await dequeue(started.port, "q");
        assertEquals(failedDequeue.status, 500);
        assertEquals(await length(started.port, "q"), "1");

        assertEquals(await enqueue(started.port, "q", "during-full"), 500);
        assertEquals(await length(started.port, "q"), "1");

        limited.kill("SIGKILL");
        await limited.status;

        const restarted = await startServer(tempDir, false);
        recovered = restarted.child;
        assertEquals(await drain(restarted.port, "q"), [payload]);
    } finally {
        if (limited) await stopServer(limited);
        if (recovered) await stopServer(recovered);
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
});
