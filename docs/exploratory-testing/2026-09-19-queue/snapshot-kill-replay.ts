// Replay: SIGKILL while the server rewrites persist.dat at startup.
// Usage (from repo root): deno run --allow-all docs/exploratory-testing/2026-09-19-queue/snapshot-kill-replay.ts
// MODE=shutdown instead sends SIGTERM to the running server and SIGKILLs it
// once the graceful-shutdown flush has truncated persist.dat.
// Builds an acknowledged backlog through the public API, crashes the server,
// restarts it with the same --persist directory, kills it as soon as the
// startup rewrite has truncated persist.dat, then restarts and counts items.

const TOKEN = "explore-token";
const ITEMS = Number(Deno.env.get("ITEMS") ?? "200");
const PAYLOAD_BYTES = 1000 * 1000; // under the 1 MB body limit
const dir = await Deno.makeTempDir({ prefix: "qx-snapshot-" });
const file = `${dir}/persist.dat`;
let port = 20100;

function log(message: string) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

async function start(): Promise<Deno.ChildProcess> {
    port++;
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts", "--persist"],
        env: {
            QUEUE_API_TOKEN: TOKEN,
            PORT: String(port),
            PERSIST: dir,
            RATE_LIMIT_REQUESTS: "100000",
        },
        stdout: "null",
        stderr: "null",
    }).spawn();
    return child;
}

async function waitReady(): Promise<void> {
    for (let i = 0; i < 600; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/health`);
            await r.body?.cancel();
            if (r.ok) return;
        } catch { /* not listening yet */ }
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("server never became ready");
}

async function api(path: string, init: RequestInit = {}): Promise<[number, string]> {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    });
    return [r.status, await r.text()];
}

function size(): number {
    try {
        return Deno.statSync(file).size;
    } catch {
        return -1;
    }
}

log(`persist dir ${dir}, ${ITEMS} items of ~${PAYLOAD_BYTES} bytes`);

// 1. Build an acknowledged backlog.
let server = await start();
await waitReady();
const filler = "x".repeat(PAYLOAD_BYTES - 40);
let acknowledged = 0;
for (let i = 0; i < ITEMS; i++) {
    const [status] = await api("/enqueue/jobs", {
        method: "POST",
        body: JSON.stringify({ payload: `${i}:${filler}` }),
    });
    if (status === 200) acknowledged++;
}
log(`acknowledged enqueues: ${acknowledged}; length=${(await api("/length/jobs"))[1]}`);

const MODE = Deno.env.get("MODE") ?? "startup";
if (MODE === "shutdown") {
    const before = size();
    server.kill("SIGTERM");
    let seen = before;
    while (seen >= before || seen < 0) {
        seen = size();
        await new Promise((r) => setTimeout(r, 1));
    }
    server.kill("SIGKILL");
    await server.status;
    log(`SIGTERM then SIGKILL during shutdown flush at size=${seen} (was ${before}); size now=${size()}`);
    server = await start();
    await waitReady();
    log(`after recovery: length=${(await api("/length/jobs"))[1]} (acknowledged ${acknowledged})`);
    server.kill("SIGTERM");
    await server.status;
    await Deno.remove(dir, { recursive: true });
    Deno.exit(0);
}

// 2. Crash (SIGKILL) so the append log is left as-is.
server.kill("SIGKILL");
await server.status;
const fullSize = size();
log(`after crash persist.dat size=${fullSize}`);

// 3. Restart; kill as soon as the startup rewrite has truncated the file.
server = await start();
let observed = fullSize;
const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
    observed = size();
    if (observed < fullSize) break;
    await new Promise((r) => setTimeout(r, 1));
}
server.kill("SIGKILL");
await server.status;
log(`killed restart while persist.dat size=${observed} (was ${fullSize}); size now=${size()}`);

// 4. Restart normally and count what survived.
server = await start();
await waitReady();
const [, length] = await api("/length/jobs");
log(`after recovery: length=${length} (acknowledged ${acknowledged}); persist.dat size=${size()}`);
server.kill("SIGTERM");
await server.status;
await Deno.remove(dir, { recursive: true });
