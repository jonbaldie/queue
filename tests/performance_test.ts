import { assert, assertEquals } from "jsr:@std/assert@1.0";
import QueueManager from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";
import * as Persistency from "../src/persist.ts";

// Timing tests live here, outside the mutation runners' test sets, because
// mutation instrumentation slows the code under test by an unknown factor.

const API_TOKEN = "test-token";
const authHeaders = { "Authorization": `Bearer ${API_TOKEN}` };

async function fastestOf(runs: number, action: () => Promise<void> | void): Promise<number> {
    let fastest = Infinity;
    for (let run = 0; run < runs; run++) {
        const start = performance.now();
        await action();
        fastest = Math.min(fastest, performance.now() - start);
    }
    return fastest;
}

Deno.test("enqueue validates a number-dense near-1 MB body faster than a single JSON reviver pass", async () => {
    const handler = createHandler(new QueueManager(new Persistency.MemoryStore()), API_TOKEN, 1000);
    const values = Array.from({ length: 500_000 }, (_, index) => index % 10);
    const body = `{"payload":[${values.join(",")}]}`;
    assert(body.length > 999_000 && body.length <= 1024 * 1024);

    const enqueueMs = await fastestOf(5, async () => {
        const enqueueResponse = await handler(new Request("http://localhost/enqueue/numbers", {
            method: "POST",
            body,
            headers: authHeaders,
        }));
        assertEquals(enqueueResponse.status, 200);
    });
    const dequeueResponse = await handler(new Request("http://localhost/dequeue/numbers", {
        headers: authHeaders,
    }));
    assertEquals(await dequeueResponse.json(), values);
    // A reviver is invoked once per JSON value, so a no-op reviver is the
    // floor for any per-value validation design. Lossless-number checks
    // must stay below it (#124).
    const noOpReviverMs = await fastestOf(5, () => {
        JSON.parse(body, (_key, value) => value);
    });

    assert(
        enqueueMs < noOpReviverMs,
        `enqueue took ${enqueueMs.toFixed(1)} ms; a no-op reviver pass took ${noOpReviverMs.toFixed(1)} ms`,
    );
});
