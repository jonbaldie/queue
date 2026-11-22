import { assertEquals, assertThrows } from "jsr:@std/assert@1.0";
import { createHandler } from "../src/handler.ts";
import QueueManager from "../src/manager.ts";
import * as Persistency from "../src/persist.ts";
import { parseConfig } from "../src/config.ts";
import type { Payload } from "../src/payload.ts";

const TOKEN = "negative-test-token";

function makeHandler(queueDepthLimit?: number, queueCountLimit?: number, rateLimit = 10000) {
    const mgr = new QueueManager<Payload>(new Persistency.MemoryStore<Payload>(), queueDepthLimit, queueCountLimit);
    return createHandler(mgr, TOKEN, rateLimit, { write() {} });
}

function request(url: string, init: RequestInit = {}) {
    return new Request(url, init);
}

async function enqueue(handler: (req: Request) => Promise<Response>, queue: string, payload: unknown): Promise<Response> {
    return handler(request(`http://localhost/enqueue/${queue}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
    }));
}

// A health-prefix trick must never reach queue data. Requests that normalize
// to /health itself may return health, but must not leak queue state.
Deno.test("negative: unauthenticated health-prefix tricks do not leak queue data", async () => {
    const handler = makeHandler();
    const seed = await enqueue(handler, "secret-q", "secret-value");
    assertEquals(seed.status, 200);

    const bypassPaths = [
        "/health/../queues",
        "/health%2f..%2fqueues",
        "/health/..;/queues",
        "/health%00/queues",
        "/health//../queues",
        "/health/queues",
        "/health%23/queues",
        "/queues%2f",
        "/queue%73",
    ];
    for (const path of bypassPaths) {
        const res = await handler(request(`http://localhost${path}`));
        assertEquals(res.status, 401, `${path} must be 401 without auth`);
        assertEquals(await res.text(), "Unauthorized", `${path} must not leak data`);
    }

    // These normalize to the health endpoint itself and must not expose queues either.
    for (const path of ["/%2e%2e/health", "/health?x=/queues"]) {
        const res = await handler(request(`http://localhost${path}`));
        assertEquals(res.status, 200, `${path} normalizes to health`);
        assertEquals(await res.json(), { status: "ok" });
    }
});

// HEAD on /dequeue must peek (the explicit HEAD route), never consume the item.
// This is a data-loss behavior: a HEAD request must be safe.
Deno.test("negative: HEAD /dequeue peeks and does not consume", async () => {
    const handler = makeHandler();
    assertEquals((await enqueue(handler, "hq", "only-item")).status, 200);

    const headRes = await handler(request("http://localhost/dequeue/hq", {
        method: "HEAD",
        headers: { Authorization: `Bearer ${TOKEN}` },
    }));
    assertEquals(headRes.status, 200);
    assertEquals(await headRes.text(), "");

    const lenRes = await handler(request("http://localhost/length/hq", {
        headers: { Authorization: `Bearer ${TOKEN}` },
    }));
    assertEquals(await lenRes.text(), "1", "HEAD must not have removed the item");

    const dequeueRes = await handler(request("http://localhost/dequeue/hq", {
        headers: { Authorization: `Bearer ${TOKEN}` },
    }));
    assertEquals(await dequeueRes.json(), "only-item");
});

// Queue name length counts code points, not UTF-16 code units. A 128-emoji
// name is exactly at the limit and must be accepted; 129 must be rejected.
Deno.test("negative: queue name 128 emoji accepted, 129 rejected", async () => {
    const handler = makeHandler();
    const okName = "😀".repeat(128);
    const tooLong = "😀".repeat(129);

    const ok = await enqueue(handler, encodeURIComponent(okName), "x");
    assertEquals(ok.status, 200);

    const bad = await enqueue(handler, encodeURIComponent(tooLong), "x");
    assertEquals(bad.status, 400);
    assertEquals(await bad.text(), "Queue name too long");
});

// FileStore.dir("") must stay in the current directory. It previously mapped
// "" to "/" and tried to write "/persist.dat" at the filesystem root.
Deno.test("negative: FileStore.dir empty string persists in current directory", () => {
    const tmpDir = Deno.makeTempDirSync();
    const previousCwd = Deno.cwd();
    const persist = new Persistency.FileStore();
    try {
        Deno.chdir(tmpDir);
        persist.dir("");
        persist.saveEvent("q", "cwd-item", true);
        assertEquals(persist.loadState()[0].payload, "cwd-item");

        let rootFile = false;
        try {
            Deno.statSync("/persist.dat");
            rootFile = true;
        } catch {
            rootFile = false;
        }
        assertEquals(rootFile, false, "must not write /persist.dat at the filesystem root");
    } finally {
        persist.close();
        Deno.chdir(previousCwd);
        Deno.removeSync(tmpDir, { recursive: true });
    }
});

// A truncated final line (crash mid-append, no trailing newline) and CRLF
// line endings must not lose the valid events around them.
Deno.test("negative: FileStore.loadState handles CRLF and truncated tail", async () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.FileStore();
    try {
        persist.dir(tmpDir);
        const event = (payload: string) =>
            JSON.stringify({ queue: "q", payload, enqueue: true, dequeue: false });
        await Deno.writeTextFile(
            tmpDir + "/persist.dat",
            event("first") + "\r\n" + event("second") + "\r\n" + '{"queue":"q","payload":"parti',
        );
        const events = persist.loadState();
        assertEquals(events.map((e) => e.payload), ["first", "second"]);
    } finally {
        persist.close();
        Deno.removeSync(tmpDir, { recursive: true });
    }
});

// Invalid configuration must fail fast at startup, not serve with bad values.
Deno.test("negative: parseConfig rejects invalid values", () => {
    const badEnvs: Record<string, string>[] = [
        { QUEUE_API_TOKEN: "tok", PORT: "70000" },
        { QUEUE_API_TOKEN: "tok", PORT: "-1" },
        { QUEUE_API_TOKEN: "tok", PORT: "3.5" },
        { QUEUE_API_TOKEN: "tok", PORT: " 3000" },
        { QUEUE_API_TOKEN: "tok", PORT: "+3000" },
        { QUEUE_API_TOKEN: "tok", QUEUE_DEPTH_LIMIT: "0" },
        { QUEUE_API_TOKEN: "tok", RATE_LIMIT_REQUESTS: "0" },
        { QUEUE_API_TOKEN: "ab cd" },
        { QUEUE_API_TOKEN: "café" },
        { QUEUE_API_TOKEN: "ab=c" },
        { QUEUE_API_TOKEN: "ab!c" },
    ];
    for (const env of badEnvs) {
        assertThrows(
            () => parseConfig(env, []),
            Error,
            undefined,
            `env ${JSON.stringify(env)} must be rejected`,
        );
    }
});

// Interleaved enqueue/dequeue must preserve FIFO exactly.
Deno.test("negative: interleaved FIFO order is exact", () => {
    const mgr = new QueueManager<number>(new Persistency.MemoryStore(), 10000, 1000, false);
    const expected: number[] = [];
    let value = 0;
    const ops = ["enq", "enq", "deq", "enq", "deq", "deq", "enq", "deq", "enq", "enq", "deq"];
    for (const op of ops) {
        if (op === "enq") {
            mgr.enqueue("q", value);
            expected.push(value);
            value++;
        } else {
            assertEquals(mgr.dequeue("q"), expected.shift());
        }
    }
    while (expected.length > 0) {
        assertEquals(mgr.dequeue("q"), expected.shift());
    }
    assertEquals(mgr.dequeue("q"), undefined);
});

// A payload string with a lone surrogate must round-trip through the server
// without becoming invalid UTF-8 on the way out.
Deno.test("negative: lone surrogate payload round-trips", async () => {
    const handler = makeHandler();
    const enq = await enqueue(handler, "surr", "\ud800");
    assertEquals(enq.status, 200);

    const res = await handler(request("http://localhost/dequeue/surr", {
        headers: { Authorization: `Bearer ${TOKEN}` },
    }));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), "\ud800");
});
