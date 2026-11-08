import { FileStore } from "../src/persist.ts";
import Manager from "../src/manager.ts";
const sizes = [262144, 524288, 1048400, 2097152];
const runs = 9;
const dir = Deno.makeTempDirSync();
try {
  for (const size of sizes) {
    const payload = "x".repeat(size);
    const line = JSON.stringify({
      queue: "jobs",
      payload,
      enqueue: true,
      dequeue: false,
    }) + "\n";
    const values: Record<string, number[]> = { read: [], startup: [] };
    let errors = 0;
    for (let i = 0; i < runs + 2; i++) {
      for (const mode of ["read", "startup"] as const) {
        Deno.writeTextFileSync(`${dir}/persist.dat`, line);
        const store = new FileStore<string>();
        store.dir(dir);
        const manager = new Manager<string>(store);
        const start = performance.now();
        const result = mode === "read"
          ? store.loadState()
          : (manager.load(), undefined);
        const elapsed = performance.now() - start;
        const actual = mode === "read"
          ? result?.[0]?.payload
          : manager.peek("jobs");
        if (actual !== payload || (result && result.length !== 1)) errors++;
        store.close();
        if (i >= 2) values[mode].push(elapsed);
      }
    }
    for (const mode of ["read", "startup"]) {
      const sorted = values[mode].toSorted((a, b) => a - b);
      console.log(
        JSON.stringify({
          mode,
          payloadBytes: size,
          logBytes: line.length,
          work: 1,
          errors,
          runs,
          medianMs: sorted[4],
          minMs: sorted[0],
          maxMs: sorted[8],
          samplesMs: values[mode],
        }),
      );
    }
    if (errors) Deno.exitCode = 1;
  }
} finally {
  Deno.removeSync(dir, { recursive: true });
}
