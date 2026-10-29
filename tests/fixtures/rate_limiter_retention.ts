// Run in a fresh process with --v8-flags=--expose-gc.
import { RateLimiter } from "../../src/rate_limiter.ts";

declare global {
    var gc: (() => void) | undefined;
}
if (!globalThis.gc) throw new Error("Garbage collection must be exposed");
const collect = globalThis.gc;
// A healthy limiter retains only the live window; an unpruned half-million
// timestamp history retains several MiB. Leave headroom for runtime overhead.
const maxRetainedBytes = 2 * 1024 * 1024;

function assertRetainedHeap(label: string, exercise: () => RateLimiter): void {
    collect();
    const before = Deno.memoryUsage().heapUsed;
    const limiter = exercise();
    collect();
    const retained = Deno.memoryUsage().heapUsed - before;
    // Keep the limiter live across collection; its keys are observable.
    if (limiter.trackedKeysCount === 0) throw new Error(`${label}: no tracked keys`);
    if (retained > maxRetainedBytes) {
        throw new Error(`${label}: retained ${retained} bytes, limit ${maxRetainedBytes}`);
    }
    console.log(`${label}: retained ${retained} bytes`);
}

assertRetainedHeap("active key", () => {
    const limiter = new RateLimiter(1001, 1000, 10_000_000);
    for (let now = 0; now < 500_000; now++) {
        if (!limiter.isAllowed("active", now)) throw new Error(`denied at ${now}`);
    }
    return limiter;
});

// Each key has a stale history and one fresh request at sweep time. The
// keys are left idle afterwards, so only the sweep can release their histories.
assertRetainedHeap("idle keys after sweep", () => {
    const limiter = new RateLimiter(5001, 1000, 500_101);
    for (let key = 0; key < 100; key++) {
        for (let i = 0; i < 5000; i++) {
            if (!limiter.isAllowed(String(key), 0)) throw new Error(`denied stale request ${key}:${i}`);
        }
    }
    for (let key = 0; key < 100; key++) {
        if (!limiter.isAllowed(String(key), 999)) throw new Error(`denied fresh request ${key}`);
    }
    if (!limiter.isAllowed("trigger", 1000)) throw new Error("denied sweep trigger");
    if (limiter.trackedKeysCount !== 101) throw new Error("sweep lost fresh keys");
    return limiter;
});

// A busy key stays at capacity while one request expires per admission. Its
// mostly live window must not be copied on every call: that turns a small
// amount of traffic into allocation proportional to the entire window.
// Measure heap growth, not elapsed time or the limiter's private storage.
const busy = new RateLimiter(100_000, 1000, 1_000_000);
for (let i = 0; i < 100_000; i++) {
    if (!busy.isAllowed("busy", i < 32 ? i : 500)) throw new Error(`denied setup request ${i}`);
}
let heapGrowth = 0;
for (let now = 1000; now < 1032; now++) {
    // Release previous garbage before each sample. Automatic collection can
    // undercount growth, so allow a wide margin rather than asserting bytes
    // per call. Keep the limiter live via the following public API calls.
    collect();
    const before = Deno.memoryUsage().heapUsed;
    if (!busy.isAllowed("busy", now)) throw new Error(`denied replacement at ${now}`);
    heapGrowth += Math.max(0, Deno.memoryUsage().heapUsed - before);
}
if (busy.trackedKeysCount !== 1) throw new Error("busy key was lost");
if (busy.isAllowed("busy", 1031)) throw new Error("busy key exceeded its limit");
// 8 MiB permits several whole-window allocations, including capacity growth,
// across these 32 admissions. Copying on every admission costs about 64 MB.
const maxHeapGrowth = 8 * 1024 * 1024;
if (heapGrowth > maxHeapGrowth) {
    throw new Error(`busy key: heap grew ${heapGrowth} bytes, limit ${maxHeapGrowth}`);
}
console.log(`busy key: heap grew ${heapGrowth} bytes across 32 admissions`);
