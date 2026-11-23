// Reproducible scaling benchmark for persisted-log recovery (issue #194).
//
// Recovery of a single long record must scale linearly with the bytes
// read. This script writes one JSON record of increasing size to an
// isolated temporary directory, times FileStore.loadState() (median of
// three runs after one warm-up), verifies the recovered payload, and
// prints the scaling ratio. Linear framing gives a ratio near 4 when
// the record size quadruples; the old re-scanning string framing gave
// ~16-22 and exits non-zero above a ratio of 8.
//
// Timings are local observations, not portable guarantees, so this is
// a standalone benchmark — not an assertion in the `deno test` suite.
//
// Usage:
//   deno run --allow-read --allow-write scripts/bench_persist_load.ts

import { FileStore } from "../src/persist.ts";
import type { Payload } from "../src/payload.ts";

function timeLoad(payloadBytes: number, repetitions = 3): number {
    const tmpDir = Deno.makeTempDirSync();
    try {
        const payload = "x".repeat(payloadBytes);
        const line = JSON.stringify({
            queue: "q",
            payload,
            enqueue: true,
            dequeue: false,
        }) + "\n";
        Deno.writeTextFileSync(tmpDir + "/persist.dat", line);
        const store = new FileStore<Payload>();
        store.dir(tmpDir);
        const warm = store.loadState();
        if (warm.length !== 1 || (warm[0].payload as string).length !== payloadBytes) {
            throw new Error("warm-up recovery mismatch");
        }
        const times: number[] = [];
        for (let rep = 0; rep < repetitions; rep++) {
            const started = performance.now();
            const events = store.loadState();
            times.push(performance.now() - started);
            if (events.length !== 1 || (events[0].payload as string).length !== payloadBytes) {
                throw new Error("recovered payload mismatch");
            }
        }
        store.close();
        times.sort((a, b) => a - b);
        return times[Math.floor(times.length / 2)];
    } finally {
        Deno.removeSync(tmpDir, { recursive: true });
    }
}

const MiB = 1024 * 1024;
const sizes = [1, 2, 4, 8];
const results = new Map<number, number>();
for (const size of sizes) {
    const milliseconds = timeLoad(size * MiB);
    results.set(size, milliseconds);
    console.log(`${size} MiB single record: ${milliseconds.toFixed(1)} ms (median of 3)`);
}

const ratio = results.get(8)! / results.get(2)!;
console.log(`ratio t(8 MiB) / t(2 MiB) = ${ratio.toFixed(2)} (linear ~4, quadratic ~16)`);
if (ratio > 8) {
    console.log("superlinear scaling: recovery is not O(total input bytes)");
    Deno.exit(1);
}
console.log("linear-ish scaling: recovery is O(total input bytes)");
