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

Deno.test("persist MemoryStore.loadState() returns empty array", () => {
    const p = new Persistency.MemoryStore();
    assertEquals(p.loadState(), []);
});

Deno.test("persist MemoryStore.saveEvent() appends", () => {
    const p = new Persistency.MemoryStore();
    p.saveEvent("q", "anything", true);
    assertEquals(p.loadState().length, 1);
});

Deno.test("persist MemoryStore.clear() clears events", () => {
    const p = new Persistency.MemoryStore();
    p.saveEvent("q", "anything", true);
    p.clear();
    assertEquals(p.loadState(), []);
});

// ── FileStore.dir() ──────────────────────────────────────────────────────────

Deno.test("persist FileStore.dir() with trailing slash writes files in that directory", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.FileStore();
    p.dir(tmpDir + "/");
    p.clear();
    p.saveEvent("q", "hello", true);
    assertEquals(p.loadState()[0].payload, "hello");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("persist FileStore.dir() without trailing slash still works", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.FileStore();
    p.dir(tmpDir);
    p.clear();
    p.saveEvent("q", "world", true);
    assertEquals(p.loadState()[0].payload, "world");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("persist FileStore.dir() multi-segment path does not corrupt the file path", () => {
    const tmpDir = Deno.makeTempDirSync();
    const sub = tmpDir + "/sub";
    Deno.mkdirSync(sub);
    const p = new Persistency.FileStore();
    p.dir(sub + "/");
    p.clear();
    p.saveEvent("q", "nested", true);
    assertEquals(p.loadState()[0].payload, "nested");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("persist FileStore.dir() second call replaces first", () => {
    const dir1 = Deno.makeTempDirSync();
    const dir2 = Deno.makeTempDirSync();
    const p = new Persistency.FileStore();
    p.dir(dir1 + "/");
    p.dir(dir2 + "/");
    p.clear();
    p.saveEvent("q", "only-in-dir2", true);
    assertEquals(p.loadState()[0].payload, "only-in-dir2");
    
    let dir1HasFile = false;
    try { Deno.statSync(dir1 + "/persist.dat"); dir1HasFile = true; } catch { /* expected */ }
    assertEquals(dir1HasFile, false);
    Deno.removeSync(dir1, { recursive: true });
    Deno.removeSync(dir2, { recursive: true });
});

// ── FileStore.saveEvent() writes in append mode ──────────────────────────────

Deno.test("persist FileStore.saveEvent() does not overwrite existing content", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.FileStore();
    p.dir(tmpDir + "/");
    p.clear();
    p.saveEvent("q", "line1", true);
    p.saveEvent("q", "line2", true);
    const events = p.loadState();
    assertEquals(events[0].payload, "line1");
    assertEquals(events[1].payload, "line2");
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── FileStore.clear() creates file if absent ─────────────────────────────────

Deno.test("persist FileStore.clear() creates file when it does not exist", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.FileStore();
    p.dir(tmpDir + "/");
    p.clear();
    assertEquals(p.loadState(), []);
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("persist FileStore.clear() truncates existing content", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.FileStore();
    p.dir(tmpDir + "/");
    p.clear();
    p.saveEvent("q", "existing", true);
    p.clear();
    assertEquals(p.loadState(), []);
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── FileStore.loadState() with large data ────────────────────────────────────

Deno.test("persist FileStore.loadState() reads large file correctly", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.FileStore<any>();
    p.dir(tmpDir + "/");
    p.clear();
    for (let i = 0; i < 100; i++) {
        p.saveEvent("q", { payload: "x".repeat(150), i }, true);
    }
    const result = p.loadState();
    assertEquals(result.length, 100);
    assertEquals(result[0].payload.i, 0);
    assertEquals(result[99].payload.i, 99);
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── FileStore.loadState() NotFound returns [] ────────────────────────────────

Deno.test("persist FileStore.loadState() returns empty array when file does not exist", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.FileStore();
    p.dir(tmpDir + "/");
    assertEquals(p.loadState(), []);
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── manager save() writes correct flags ──────────────────────────────────────

Deno.test("manager save() writes enqueue:true dequeue:false for each item", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.FileStore();
    persist.dir(tmpDir + "/");
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("myq", "alpha");
    mgr.enqueue("myq", "beta");
    persist.clear();
    mgr.save();

    const events = persist.loadState();
    assertEquals(events.length, 2);
    assertEquals(events[0].enqueue, true);
    assertEquals(events[0].dequeue, false);
    assertEquals(events[1].enqueue, true);
    assertEquals(events[1].dequeue, false);
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("manager save() writes correct payloads in queue order", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.FileStore();
    persist.dir(tmpDir + "/");
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q", "first");
    mgr.enqueue("q", "second");
    persist.clear();
    mgr.save();

    const events = persist.loadState();
    assertEquals(events[0].payload, "first");
    assertEquals(events[1].payload, "second");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("manager save() on empty manager writes nothing", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.FileStore();
    persist.dir(tmpDir + "/");
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.save();

    assertEquals(persist.loadState(), []);
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── manager enqueue log has correct flags ─────────────────────────────────────

Deno.test("manager enqueue log: enqueue=true dequeue=false", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.FileStore();
    persist.dir(tmpDir + "/");
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q", "item");

    const events = persist.loadState();
    assertEquals(events[0].enqueue, true);
    assertEquals(events[0].dequeue, false);
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("manager dequeue log: enqueue=false dequeue=true", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.FileStore();
    persist.dir(tmpDir + "/");
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q", "item");
    persist.clear();
    mgr.dequeue("q");

    const events = persist.loadState();
    assertEquals(events[0].enqueue, false);
    assertEquals(events[0].dequeue, true);
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── manager load() processes both enqueue and dequeue entries ─────────────────

Deno.test("manager load() enqueue entry adds item to queue", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.FileStore();
    persist.dir(tmpDir + "/");
    persist.clear();
    persist.saveEvent("q", "x", true);

    const mgr = new QueueManager(persist);
    mgr.load();
    assertEquals(mgr.dequeue("q"), "x");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("manager load() dequeue entry removes item from queue", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.FileStore();
    persist.dir(tmpDir + "/");
    persist.clear();
    persist.saveEvent("q", "x", true);
    persist.saveEvent("q", "x", false);

    const mgr = new QueueManager(persist);
    mgr.load();
    assertEquals(mgr.length("q"), 0);
    Deno.removeSync(tmpDir, { recursive: true });
});
