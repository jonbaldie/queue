import { assertEquals, assertNotEquals } from "jsr:@std/assert@1.0";
import * as Persistency from "../src/persist.ts";
import QueueManager from "../src/manager.ts";

// ── None class ────────────────────────────────────────────────────────────────

Deno.test("persist None.load() returns empty string", () => {
    const p = new Persistency.None();
    assertEquals(p.load(), "");
});

Deno.test("persist None.append() is a no-op", () => {
    const p = new Persistency.None();
    p.append("anything");
    assertEquals(p.load(), "");
});

Deno.test("persist None.clear() is a no-op", () => {
    const p = new Persistency.None();
    p.clear();
    assertEquals(p.load(), "");
});

Deno.test("persist None.dir() is a no-op", () => {
    const p = new Persistency.None();
    p.dir("/some/path/");
    assertEquals(p.load(), "");
});

// ── File.dir() ────────────────────────────────────────────────────────────────

Deno.test("persist File.dir() with trailing slash writes files in that directory", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.File();
    p.dir(tmpDir + "/");
    p.clear();
    p.append("hello");
    assertEquals(p.load(), "hello\n");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("persist File.dir() without trailing slash still works", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.File();
    p.dir(tmpDir);
    p.clear();
    p.append("world");
    assertEquals(p.load(), "world\n");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("persist File.dir() multi-segment path does not corrupt the file path", () => {
    const tmpDir = Deno.makeTempDirSync();
    const sub = tmpDir + "/sub";
    Deno.mkdirSync(sub);
    const p = new Persistency.File();
    p.dir(sub + "/");
    p.clear();
    p.append("nested");
    assertEquals(p.load(), "nested\n");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("persist File.dir() second call replaces first (not appends)", () => {
    const dir1 = Deno.makeTempDirSync();
    const dir2 = Deno.makeTempDirSync();
    const p = new Persistency.File();
    p.dir(dir1 + "/");
    p.dir(dir2 + "/");  // should overwrite, not accumulate
    p.clear();
    p.append("only-in-dir2");
    // Data must be in dir2, not dir1/dir2 composite path
    assertEquals(p.load(), "only-in-dir2\n");
    // dir1 persist.dat must not exist
    let dir1HasFile = false;
    try { Deno.statSync(dir1 + "/persist.dat"); dir1HasFile = true; } catch { /* expected */ }
    assertEquals(dir1HasFile, false);
    Deno.removeSync(dir1, { recursive: true });
    Deno.removeSync(dir2, { recursive: true });
});

// ── File.append() writes in append mode ──────────────────────────────────────

Deno.test("persist File.append() does not overwrite existing content", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.File();
    p.dir(tmpDir + "/");
    p.clear();
    p.append("line1");
    p.append("line2");
    const content = p.load();
    const lines = content.split("\n").filter(Boolean);
    assertEquals(lines, ["line1", "line2"]);
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("persist File.append() actually writes data (write flag must be true)", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.File();
    p.dir(tmpDir + "/");
    p.clear();
    p.append("data");
    assertNotEquals(p.load(), "");
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── File.clear() creates file if absent ──────────────────────────────────────

Deno.test("persist File.clear() creates file when it does not exist", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.File();
    p.dir(tmpDir + "/");
    // No prior clear or append — file doesn't exist yet
    p.clear();
    assertEquals(p.load(), "");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("persist File.clear() truncates existing content", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.File();
    p.dir(tmpDir + "/");
    p.clear();
    p.append("existing");
    p.clear();
    assertEquals(p.load(), "");
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── File.load() with large data (covers totalRead += read path) ───────────────

Deno.test("persist File.load() reads large file correctly across multiple 4096-byte chunks", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.File();
    p.dir(tmpDir + "/");
    p.clear();
    // Each line is ~200 bytes; 100 lines = ~20KB > 4096-byte chunk, forces multi-chunk read
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
        const line = `{"queue":"q","payload":"${"x".repeat(150)}","i":${i}}`;
        lines.push(line);
        p.append(line);
    }
    const loaded = p.load();
    const result = loaded.split("\n").filter(Boolean);
    assertEquals(result.length, 100);
    assertEquals(JSON.parse(result[0]).i, 0);
    assertEquals(JSON.parse(result[99]).i, 99);
    // Verify totalRead is correct (all bytes present, not just first chunk)
    assertEquals(loaded.includes('"i":50'), true);
    assertEquals(loaded.includes('"i":99'), true);
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── File.load() NotFound returns "" ──────────────────────────────────────────

Deno.test("persist File.load() returns empty string when file does not exist", () => {
    const tmpDir = Deno.makeTempDirSync();
    const p = new Persistency.File();
    p.dir(tmpDir + "/");
    // Do NOT call clear() — file won't exist
    assertEquals(p.load(), "");
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── manager save() writes correct flags ──────────────────────────────────────

Deno.test("manager save() writes enqueue:true dequeue:false for each item", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.File();
    persist.dir(tmpDir + "/");
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("myq", "alpha");
    mgr.enqueue("myq", "beta");
    // Drain persist log before save
    persist.clear();
    mgr.save();

    const lines = persist.load().split("\n").filter(Boolean);
    assertEquals(lines.length, 2);
    const a = JSON.parse(lines[0]);
    const b = JSON.parse(lines[1]);
    assertEquals(a.enqueue, true);
    assertEquals(a.dequeue, false);
    assertEquals(b.enqueue, true);
    assertEquals(b.dequeue, false);
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("manager save() writes correct payloads in queue order", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.File();
    persist.dir(tmpDir + "/");
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q", "first");
    mgr.enqueue("q", "second");
    persist.clear();
    mgr.save();

    const lines = persist.load().split("\n").filter(Boolean);
    assertEquals(JSON.parse(lines[0]).payload, "first");
    assertEquals(JSON.parse(lines[1]).payload, "second");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("manager save() on empty manager writes nothing", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.File();
    persist.dir(tmpDir + "/");
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.save();

    assertEquals(persist.load(), "");
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── manager enqueue log has correct flags ─────────────────────────────────────

Deno.test("manager enqueue log: enqueue=true dequeue=false", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.File();
    persist.dir(tmpDir + "/");
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q", "item");

    const lines = persist.load().split("\n").filter(Boolean);
    const entry = JSON.parse(lines[0]);
    assertEquals(entry.enqueue, true);
    assertEquals(entry.dequeue, false);
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("manager dequeue log: enqueue=false dequeue=true", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.File();
    persist.dir(tmpDir + "/");
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q", "item");
    persist.clear();
    mgr.dequeue("q");

    const lines = persist.load().split("\n").filter(Boolean);
    const entry = JSON.parse(lines[0]);
    assertEquals(entry.enqueue, false);
    assertEquals(entry.dequeue, true);
    Deno.removeSync(tmpDir, { recursive: true });
});

// ── manager load() processes both enqueue and dequeue entries ─────────────────

Deno.test("manager load() enqueue entry adds item to queue", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.File();
    persist.dir(tmpDir + "/");
    persist.clear();
    persist.append(JSON.stringify({ queue: "q", payload: "x", enqueue: true, dequeue: false }));

    const mgr = new QueueManager(persist);
    mgr.load();
    assertEquals(mgr.dequeue("q"), "x");
    Deno.removeSync(tmpDir, { recursive: true });
});

Deno.test("manager load() dequeue entry removes item from queue", () => {
    const tmpDir = Deno.makeTempDirSync();
    const persist = new Persistency.File();
    persist.dir(tmpDir + "/");
    persist.clear();
    persist.append(JSON.stringify({ queue: "q", payload: "x", enqueue: true, dequeue: false }));
    persist.append(JSON.stringify({ queue: "q", payload: "x", enqueue: false, dequeue: true }));

    const mgr = new QueueManager(persist);
    mgr.load();
    assertEquals(mgr.length("q"), 0);
    Deno.removeSync(tmpDir, { recursive: true });
});
