import QueueManager, { MAX_QUEUE_NAME_LENGTH, QueueNameTooLongError } from "../src/manager.ts";
import * as Persistency from "../src/persist.ts";
import { createHandler } from "../src/handler.ts";
import { RateLimiter } from "../src/rate_limiter.ts";
import { parseConfig, ConfigError } from "../src/config.ts";

console.log("=== STARTING DEEP PROPERTY & INVARIANT FUZZING ===");

let totalTests = 0;
let totalFailures = 0;
const failures: string[] = [];

function check(desc: string, ok: boolean, detail = "") {
    totalTests++;
    if (!ok) {
        totalFailures++;
        failures.push(`${desc}: ${detail}`);
        console.error(`FAIL: ${desc} - ${detail}`);
    }
}

// ---------------------------------------------------------------------------
// TEST SUITE 1: JSON numbers & canonicalization properties
// ---------------------------------------------------------------------------
console.log("\n--- Testing JSON Numbers & Body Parsing ---");
{
    const mgr = new QueueManager(new Persistency.MemoryStore());
    const handler = createHandler(mgr, "tok");

    // Test numbers that SHOULD be supported
    const supportedNumbers = [
        0, -0, 1, -1, 42, -42, 3.14159, -3.14159,
        1e5, 1e-5, -1e5, -1e-5, 1.5e3, -1.5e3,
        9007199254740991, -9007199254740991, // MAX_SAFE_INTEGER
        0.000001, 1000000, 1e20, 1e-20,
    ];

    for (const num of supportedNumbers) {
        const res = await handler(new Request("http://localhost/enqueue/numq", {
            method: "POST",
            headers: { "Authorization": "Bearer tok", "Content-Type": "application/json" },
            body: JSON.stringify({ payload: num }),
        }));
        check(`Supported number ${num}`, res.status === 200, `status=${res.status} body=${await res.text()}`);
        if (res.status === 200) {
            const deq = await handler(new Request("http://localhost/dequeue/numq", {
                headers: { "Authorization": "Bearer tok" },
            }));
            const val = await deq.json();
            if (Object.is(num, -0)) {
                check(`Value preservation for -0`, val === 0, `got=${val}`);
            } else {
                check(`Value preservation for ${num}`, val === num, `got=${val} expected=${num}`);
            }
        }
    }

    // Test numbers that SHOULD be rejected
    const unsupportedNumbers = [
        "1e400", "-1e400", "9007199254740993", "-9007199254740993",
        "1e-400", "1.00000000000000000001",
    ];

    for (const raw of unsupportedNumbers) {
        const res = await handler(new Request("http://localhost/enqueue/numq", {
            method: "POST",
            headers: { "Authorization": "Bearer tok", "Content-Type": "application/json" },
            body: `{"payload": ${raw}}`,
        }));
        check(`Unsupported number ${raw} rejected with 400`, res.status === 400, `status=${res.status} body=${await res.text()}`);
    }
}

// ---------------------------------------------------------------------------
// TEST SUITE 2: Queue Names & URL Encoding
// ---------------------------------------------------------------------------
console.log("\n--- Testing Queue Names & URL Encoding ---");
{
    const mgr = new QueueManager(new Persistency.MemoryStore());
    const handler = createHandler(mgr, "tok");

    const specialQueueNames = [
        "simple",
        "with space",
        "unicode-ñoño",
        "emoji-🔑",
        "slashes/inside",
        "dots..inside",
        "plus+sign",
        "percent%sign",
        "quote'and\"double",
        "newline\ninside",
        "tab\tinside",
        "N".repeat(128), // exact max
    ];

    for (const name of specialQueueNames) {
        const enc = encodeURIComponent(name);
        const enqRes = await handler(new Request(`http://localhost/enqueue/${enc}`, {
            method: "POST",
            headers: { "Authorization": "Bearer tok", "Content-Type": "application/json" },
            body: JSON.stringify({ payload: `data-for-${name}` }),
        }));
        check(`Enqueue to special name "${name}"`, enqRes.status === 200, `status=${enqRes.status} body=${await enqRes.text()}`);

        const lenRes = await handler(new Request(`http://localhost/length/${enc}`, {
            headers: { "Authorization": "Bearer tok" },
        }));
        const lenText = await lenRes.text();
        check(`Length for "${name}" is 1`, lenRes.status === 200 && lenText === "1", `status=${lenRes.status} len=${lenText}`);

        const deqRes = await handler(new Request(`http://localhost/dequeue/${enc}`, {
            headers: { "Authorization": "Bearer tok" },
        }));
        const deqVal = await deqRes.json();
        check(`Dequeue from "${name}"`, deqRes.status === 200 && deqVal === `data-for-${name}`, `status=${deqRes.status} val=${deqVal}`);
    }

    // Queue name > 128 characters rejected
    const tooLong = "N".repeat(129);
    const longRes = await handler(new Request(`http://localhost/enqueue/${tooLong}`, {
        method: "POST",
        headers: { "Authorization": "Bearer tok", "Content-Type": "application/json" },
        body: JSON.stringify({ payload: "too-long" }),
    }));
    check("Queue name of 129 chars rejected with 400", longRes.status === 400, `status=${longRes.status}`);

    // Malformed percent encoding
    const malformed = await handler(new Request(`http://localhost/enqueue/%ZZ`, {
        method: "POST",
        headers: { "Authorization": "Bearer tok", "Content-Type": "application/json" },
        body: JSON.stringify({ payload: "malformed" }),
    }));
    check("Malformed percent-encoding %ZZ rejected with 400", malformed.status === 400, `status=${malformed.status}`);
}

// ---------------------------------------------------------------------------
// TEST SUITE 3: HTTP Protocol Compliance & Method Routing
// ---------------------------------------------------------------------------
console.log("\n--- Testing HTTP Protocol Compliance & Method Routing ---");
{
    const mgr = new QueueManager(new Persistency.MemoryStore());
    const handler = createHandler(mgr, "tok");

    // All endpoints and their expected allowed methods
    const routes: [string, string, string[]][] = [
        ["/health", "GET", ["GET"]],
        ["/health/", "GET", ["GET"]],
        ["/queues", "GET", ["GET"]],
        ["/enqueue/test", "POST", ["POST"]],
        ["/dequeue/test", "GET", ["GET"]],
        ["/peek/test", "GET", ["GET"]],
        ["/length/test", "GET", ["GET"]],
    ];

    const allMethods = ["GET", "POST", "HEAD", "PUT", "DELETE", "OPTIONS", "PATCH"];

    for (const [path, primaryMethod, allowed] of routes) {
        for (const method of allMethods) {
            const isAllowed = allowed.includes(method) || (method === "HEAD" && allowed.includes("GET"));
            const req = new Request(`http://localhost${path}`, {
                method,
                headers: { "Authorization": "Bearer tok", "Content-Type": "application/json" },
                body: method === "POST" ? JSON.stringify({ payload: "item" }) : undefined,
            });
            const res = await handler(req);

            if (isAllowed) {
                check(`${method} ${path} is allowed`, res.status !== 405, `got ${res.status}`);
            } else {
                check(`${method} ${path} returns 405 Method Not Allowed`, res.status === 405, `got ${res.status}`);
                const allow = res.headers.get("Allow");
                check(`${method} ${path} 405 response has Allow header`, allow !== null, `Allow=${allow}`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// TEST SUITE 4: Persistence Metamorphic Invariants
// ---------------------------------------------------------------------------
console.log("\n--- Testing Persistence Invariants ---");
{
    const tempDir = await Deno.makeTempDir();
    try {
        const store = new Persistency.FileStore<unknown>();
        store.dir(tempDir);
        const mgr = new QueueManager(store, 100, 50, true);

        // Enqueue various complex types
        mgr.enqueue("q1", { a: [1, 2, { b: "hello" }], c: true });
        mgr.enqueue("q1", "second");
        mgr.enqueue("q2", 42);
        mgr.enqueue("q2", null as any); // if enqueued directly in manager
        mgr.enqueue("q3", "");
        mgr.dequeue("q1"); // dequeue "first"

        mgr.save();

        // Create fresh manager from same store
        const store2 = new Persistency.FileStore<unknown>();
        store2.dir(tempDir);
        const mgr2 = new QueueManager(store2, 100, 50, true);
        mgr2.load();

        check("Replayed manager has q1", mgr2.length("q1") === 1, `len=${mgr2.length("q1")}`);
        check("q1 item is 'second'", mgr2.dequeue("q1") === "second");
        check("q2 length is 2", mgr2.length("q2") === 2);
        check("q2 item 1 is 42", mgr2.dequeue("q2") === 42);
        check("q2 item 2 is null", mgr2.dequeue("q2") === null);
        check("q3 length is 1", mgr2.length("q3") === 1);
        check("q3 item is ''", mgr2.dequeue("q3") === "");
    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
}

// ---------------------------------------------------------------------------
// TEST SUITE 5: Configuration Parser Edge Cases
// ---------------------------------------------------------------------------
console.log("\n--- Testing Configuration Parser ---");
{
    // Token validity
    const validTokens = [
        "secret", "token_123", "a-b.c~d+e/f=", "abc==", "ALPHA123",
    ];
    for (const tok of validTokens) {
        try {
            const cfg = parseConfig({ QUEUE_API_TOKEN: tok }, []);
            check(`Valid token "${tok}" accepted`, cfg.apiToken === tok);
        } catch (e) {
            check(`Valid token "${tok}" accepted`, false, `${e}`);
        }
    }

    const invalidTokens = [
        "", " ", "\t", "token with space", "token\nnewline",
        "€euro", "🔑emoji", "éaccent", "=onlyequals", "==onlyequals",
        "middle=equal",
    ];
    for (const tok of invalidTokens) {
        try {
            parseConfig({ QUEUE_API_TOKEN: tok }, []);
            check(`Invalid token "${tok}" rejected`, false, "did not throw");
        } catch (e) {
            check(`Invalid token "${tok}" rejected`, e instanceof ConfigError, `${e}`);
        }
    }
}

console.log("\n=================================================");
console.log(`DEEP FUZZ COMPLETE: ${totalTests} checks, ${totalFailures} failures`);
if (failures.length > 0) {
    console.error("FAILURES:\n" + failures.join("\n"));
    Deno.exit(1);
} else {
    console.log("ALL INVARIANTS SATISFIED.");
}
