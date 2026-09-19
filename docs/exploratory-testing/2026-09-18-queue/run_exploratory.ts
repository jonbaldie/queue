import {
    startServer,
    stopServer,
    request,
    postInit,
    authHeaders,
    record,
    RunningServer,
    ResponseSummary
} from "./driver.ts";
import { assertEquals, assert } from "jsr:@std/assert@1.0";

const MAX_BODY_SIZE = 1024 * 1024;

function makeExactBody(byteLength: number): string {
    const prefix = '{"payload":"';
    const suffix = '"}';
    return `${prefix}${"x".repeat(byteLength - new TextEncoder().encode(prefix + suffix).byteLength)}${suffix}`;
}

async function journey1CoreFifoAndPayloads(): Promise<void> {
    console.log("=== Starting Journey 1: Core FIFO, Multi-Queue Isolation, Payload Fidelity & Edge Values ===");
    const server = await startServer();
    try {
        const auth = authHeaders();

        // Health check probes
        record("j1-fifo", "health-get", await request(server, "/health"), "200 OK without auth");
        record("j1-fifo", "health-head", await request(server, "/health", { method: "HEAD" }), "200 OK without auth, no body");
        record("j1-fifo", "health-trailing-slash", await request(server, "/health/"), "200 OK without auth");

        // Initial state
        record("j1-fifo", "initial-queues", await request(server, "/queues", { headers: auth }), "200 []");

        // Comprehensive payload types & values
        const testPayloads: [string, unknown][] = [
            ["string-ascii", "order-101"],
            ["string-unicode", "🔥 rocket 🚀 ñoño 漢字"],
            ["string-empty", ""],
            ["string-newlines", "line1\nline2\r\nline3"],
            ["string-json-escapes", "\"quoted\" and \\backslashed\\"],
            ["number-zero", 0],
            ["number-negative-zero", -0],
            ["number-pos-int", 42],
            ["number-neg-int", -42],
            ["number-float", 3.14159],
            ["number-exp-pos", 1e5],
            ["number-exp-neg", 1e-5],
            ["number-max-safe", 9007199254740991],
            ["number-min-safe", -9007199254740991],
            ["boolean-true", true],
            ["boolean-false", false],
            ["object-empty", {}],
            ["object-simple", { item: "widget", count: 5 }],
            ["object-nested", { user: { id: 1, active: true, tags: ["a", "b"] } }],
            ["object-with-proto-key", { __proto__: { foo: "bar" }, standard: 123 }],
            ["array-empty", []],
            ["array-mixed", [1, "two", false, null, { nested: true }]],
        ];

        for (const [label, payload] of testPayloads) {
            const res = await request(server, "/enqueue/orders", postInit(JSON.stringify({ payload })));
            record("j1-fifo", `enqueue-${label}`, res, "200 acknowledged");
        }

        // Second isolated queue
        record("j1-fifo", "enqueue-notifications", await request(server, "/enqueue/notifications", postInit(JSON.stringify({ payload: "user-registered" }))), "200 acknowledged");

        // Queue listing & lengths
        const queuesRes = await request(server, "/queues", { headers: auth });
        record("j1-fifo", "queues-list", queuesRes, '200 ["orders", "notifications"]');

        const ordersLen = await request(server, "/length/orders", { headers: auth });
        record("j1-fifo", "length-orders", ordersLen, `200 text/plain ${testPayloads.length}`);

        const notifLen = await request(server, "/length/notifications", { headers: auth });
        record("j1-fifo", "length-notifications", notifLen, "200 text/plain 1");

        // Peek & HEAD behavior (non-mutating)
        record("j1-fifo", "peek-orders-get", await request(server, "/peek/orders", { headers: auth }), '200 "order-101"');
        record("j1-fifo", "peek-orders-head", await request(server, "/peek/orders", { method: "HEAD", headers: auth }), "200 no body");
        record("j1-fifo", "dequeue-orders-head", await request(server, "/dequeue/orders", { method: "HEAD", headers: auth }), "200 no body (non-consuming)");
        record("j1-fifo", "length-orders-after-head", await request(server, "/length/orders", { headers: auth }), `still ${testPayloads.length}`);

        // Dequeue each in FIFO order and verify exact value fidelity
        for (const [label, expected] of testPayloads) {
            const deq = await request(server, "/dequeue/orders", { headers: auth });
            const expectedStr = JSON.stringify(expected);
            record("j1-fifo", `dequeue-${label}`, deq, `200 matching ${expectedStr}`);
        }

        // Dequeue when empty
        record("j1-fifo", "dequeue-orders-empty", await request(server, "/dequeue/orders", { headers: auth }), "204 No Content");
        record("j1-fifo", "peek-orders-empty", await request(server, "/peek/orders", { headers: auth }), "204 No Content");
        record("j1-fifo", "length-orders-empty", await request(server, "/length/orders", { headers: auth }), "200 0");

        // Verify orders automatically removed from list
        record("j1-fifo", "queues-after-orders-drained", await request(server, "/queues", { headers: auth }), '200 ["notifications"]');

        // Drain notifications
        record("j1-fifo", "dequeue-notifications", await request(server, "/dequeue/notifications", { headers: auth }), '200 "user-registered"');
        record("j1-fifo", "queues-after-all-drained", await request(server, "/queues", { headers: auth }), "200 []");

    } finally {
        await stopServer(server);
    }
}

async function journey2ProtocolValidationAndLimits(): Promise<void> {
    console.log("=== Starting Journey 2: Protocol, Validation, Authentication, Limits & Error Paths ===");
    const server = await startServer({ QUEUE_DEPTH_LIMIT: "3", QUEUE_COUNT_LIMIT: "2" });
    try {
        const auth = authHeaders();

        // Authentication checks
        record("j2-protocol", "auth-missing-header", await request(server, "/queues"), "401 with WWW-Authenticate: Bearer");
        record("j2-protocol", "auth-invalid-scheme", await request(server, "/queues", { headers: { Authorization: "Basic 123" } }), "401 with WWW-Authenticate: Bearer");
        record("j2-protocol", "auth-wrong-token", await request(server, "/queues", { headers: { Authorization: "Bearer wrong" } }), "401 with WWW-Authenticate: Bearer");
        record("j2-protocol", "auth-scheme-lowercase", await request(server, "/queues", { headers: { Authorization: "bearer explore-token-20260918" } }), "200 OK");
        record("j2-protocol", "auth-scheme-uppercase", await request(server, "/queues", { headers: { Authorization: "BEARER explore-token-20260918" } }), "200 OK");
        record("j2-protocol", "auth-multiple-spaces", await request(server, "/queues", { headers: { Authorization: "Bearer    explore-token-20260918" } }), "200 OK");
        record("j2-protocol", "auth-tab-delimited", await request(server, "/queues", { headers: { Authorization: "Bearer\texplore-token-20260918" } }), "200 OK");

        // Method Not Allowed & Allow headers
        record("j2-protocol", "mna-health-post", await request(server, "/health", { method: "POST" }), "405 Allow: GET");
        record("j2-protocol", "mna-queues-post", await request(server, "/queues", { method: "POST", headers: auth }), "405 Allow: GET");
        record("j2-protocol", "mna-queues-delete", await request(server, "/queues", { method: "DELETE", headers: auth }), "405 Allow: GET");
        record("j2-protocol", "mna-enqueue-get", await request(server, "/enqueue/test", { headers: auth }), "405 Allow: POST");
        record("j2-protocol", "mna-dequeue-post", await request(server, "/dequeue/test", { method: "POST", headers: auth }), "405 Allow: GET");
        record("j2-protocol", "mna-peek-post", await request(server, "/peek/test", { method: "POST", headers: auth }), "405 Allow: GET");
        record("j2-protocol", "mna-length-post", await request(server, "/length/test", { method: "POST", headers: auth }), "405 Allow: GET");

        // 404 routes
        record("j2-protocol", "not-found-unknown", await request(server, "/unknown-path", { headers: auth }), "404 Not found.");
        record("j2-protocol", "not-found-enqueue-base", await request(server, "/enqueue", { headers: auth }), "404 Not found.");
        record("j2-protocol", "not-found-enqueue-slash", await request(server, "/enqueue/", { headers: auth }), "404 Not found.");
        record("j2-protocol", "not-found-dequeue-slash", await request(server, "/dequeue/", { headers: auth }), "404 Not found.");

        // Input validation on POST /enqueue
        record("j2-protocol", "val-empty-body", await request(server, "/enqueue/val", postInit("")), "400 Invalid JSON");
        record("j2-protocol", "val-malformed-json", await request(server, "/enqueue/val", postInit("{broken")), "400 Invalid JSON");
        record("j2-protocol", "val-missing-payload-key", await request(server, "/enqueue/val", postInit('{"msg":"hi"}')), "400 Missing payload key");
        record("j2-protocol", "val-empty-object", await request(server, "/enqueue/val", postInit('{}')), "400 Missing payload key");
        record("j2-protocol", "val-array-body", await request(server, "/enqueue/val", postInit('[]')), "400 Missing payload key");
        record("j2-protocol", "val-primitive-number", await request(server, "/enqueue/val", postInit('123')), "400 Missing payload key");
        record("j2-protocol", "val-null-payload", await request(server, "/enqueue/val", postInit('{"payload":null}')), "400 Null payload not allowed");
        record("j2-protocol", "val-unsafe-number-overflow", await request(server, "/enqueue/val", postInit('{"payload":9007199254740993}')), "400 Payload contains an unsupported number");
        record("j2-protocol", "val-unsafe-number-underflow", await request(server, "/enqueue/val", postInit('{"payload":1e-325}')), "400 Payload contains an unsupported number");
        record("j2-protocol", "val-overflow-number", await request(server, "/enqueue/val", postInit('{"payload":1e309}')), "400 Payload contains an unsupported number");

        // Queue name validation
        const name128 = "x".repeat(128);
        const name129 = "x".repeat(129);
        record("j2-protocol", "val-name-128-chars", await request(server, `/enqueue/${name128}`, postInit('{"payload":"ok"}')), "200 OK");
        record("j2-protocol", "val-name-129-chars", await request(server, `/enqueue/${name129}`, postInit('{"payload":"too long"}')), "400 Queue name too long");
        record("j2-protocol", "val-name-bad-percent", await request(server, "/enqueue/%ZZ", postInit('{"payload":"bad"}')), "400 Invalid queue name");
        // Drain name128 so count limit isn't occupied
        await request(server, `/dequeue/${name128}`, { headers: auth });

        // Body size limits
        record("j2-protocol", "body-exact-1mb", await request(server, "/enqueue/size", postInit(makeExactBody(MAX_BODY_SIZE))), "200 OK");
        record("j2-protocol", "body-over-1mb", await request(server, "/enqueue/size", postInit(makeExactBody(MAX_BODY_SIZE + 1))), "413 Payload too large");
        await new Promise(r => setTimeout(r, 100));
        // Drain size queue
        await request(server, "/dequeue/size", { headers: auth });

        // Depth limit (QUEUE_DEPTH_LIMIT=3)
        record("j2-protocol", "depth-1", await request(server, "/enqueue/depth-q", postInit('{"payload":1}')), "200 OK");
        record("j2-protocol", "depth-2", await request(server, "/enqueue/depth-q", postInit('{"payload":2}')), "200 OK");
        record("j2-protocol", "depth-3", await request(server, "/enqueue/depth-q", postInit('{"payload":3}')), "200 OK");
        record("j2-protocol", "depth-4-rejected", await request(server, "/enqueue/depth-q", postInit('{"payload":4}')), "507 Queue full or too many queues");
        record("j2-protocol", "depth-length-is-3", await request(server, "/length/depth-q", { headers: auth }), "200 3");
        // Dequeue one to free depth capacity
        record("j2-protocol", "depth-dequeue-free", await request(server, "/dequeue/depth-q", { headers: auth }), "200 1");
        record("j2-protocol", "depth-retry-succeeds", await request(server, "/enqueue/depth-q", postInit('{"payload":4}')), "200 OK after capacity freed");

        // Count limit (QUEUE_COUNT_LIMIT=2)
        record("j2-protocol", "count-q2-create", await request(server, "/enqueue/q2", postInit('{"payload":"item-q2"}')), "200 OK");
        record("j2-protocol", "count-q3-rejected", await request(server, "/enqueue/q3", postInit('{"payload":"item-q3"}')), "507 Queue full or too many queues");
        record("j2-protocol", "count-q2-drain", await request(server, "/dequeue/q2", { headers: auth }), "200 item-q2");
        record("j2-protocol", "count-q3-retry-succeeds", await request(server, "/enqueue/q3", postInit('{"payload":"item-q3"}')), "200 OK after queue freed");

    } finally {
        await stopServer(server);
    }

    // Rate limiting test in separate server
    console.log("--- Testing Rate Limiting ---");
    const rateServer = await startServer({ RATE_LIMIT_REQUESTS: "5" });
    try {
        const auth = authHeaders();
        for (let i = 1; i <= 5; i++) {
            const res = await request(rateServer, "/queues", { headers: auth });
            record("j2-ratelimit", `req-${i}`, res, "200 OK");
        }
        const blocked = await request(rateServer, "/queues", { headers: auth });
        record("j2-ratelimit", "req-6-blocked", blocked, "429 Too many requests");

        // Health check should NOT be rate limited
        const healthRes = await request(rateServer, "/health");
        record("j2-ratelimit", "health-bypass", healthRes, "200 OK bypasses rate limit");
    } finally {
        await stopServer(rateServer);
    }
}

async function journey3PersistenceAndRestarts(): Promise<void> {
    console.log("=== Starting Journey 3: Persistence, Clean Restarts & Crash Recovery ===");
    const tempDir = await Deno.makeTempDir({ prefix: "queue-explore-persist-" });
    try {
        // Part A: Clean shutdown & restart
        console.log("--- Part A: Clean graceful restart ---");
        const server1 = await startServer({}, true, tempDir);
        const auth = authHeaders();
        try {
            await request(server1, "/enqueue/p1", postInit('{"payload":"alpha"}'));
            await request(server1, "/enqueue/p1", postInit('{"payload":"beta"}'));
            await request(server1, "/enqueue/p2", postInit('{"payload":"gamma"}'));
            await request(server1, "/dequeue/p1", { headers: auth }); // removes alpha, leaves beta
        } finally {
            await stopServer(server1, "SIGTERM");
        }

        // Inspect snapshot file on disk
        const snapshot1 = await Deno.readTextFile(`${tempDir}/persist.dat`);
        record("j3-persist", "clean-snapshot-content", { status: 200, body: snapshot1.trim(), headers: {} }, "snapshot contains only remaining items (beta on p1, gamma on p2)");

        // Start server2 against same dir
        const server2 = await startServer({}, true, tempDir);
        try {
            record("j3-persist", "server2-queues", await request(server2, "/queues", { headers: auth }), '200 ["p1", "p2"]');
            record("j3-persist", "server2-p1-len", await request(server2, "/length/p1", { headers: auth }), "200 1");
            record("j3-persist", "server2-p2-len", await request(server2, "/length/p2", { headers: auth }), "200 1");
            record("j3-persist", "server2-p1-dequeue", await request(server2, "/dequeue/p1", { headers: auth }), '200 "beta"');
            record("j3-persist", "server2-p2-dequeue", await request(server2, "/dequeue/p2", { headers: auth }), '200 "gamma"');
            record("j3-persist", "server2-queues-empty", await request(server2, "/queues", { headers: auth }), "200 []");
        } finally {
            await stopServer(server2, "SIGTERM");
        }

        // Part B: Crash recovery (SIGKILL) with unchanged limits
        console.log("--- Part B: Crash recovery (SIGKILL) ---");
        const crashDir = await Deno.makeTempDir({ prefix: "queue-explore-crash-" });
        try {
            const crashServer = await startServer({}, true, crashDir);
            try {
                await request(crashServer, "/enqueue/tasks", postInit('{"payload":"task-1"}'));
                await request(crashServer, "/enqueue/tasks", postInit('{"payload":"task-2"}'));
                await request(crashServer, "/enqueue/tasks", postInit('{"payload":"task-3"}'));
                await request(crashServer, "/dequeue/tasks", { headers: auth }); // removes task-1
            } finally {
                await stopServer(crashServer, "SIGKILL");
            }

            // Inspect uncompacted event log on disk
            const uncompactedLog = await Deno.readTextFile(`${crashDir}/persist.dat`);
            const logLines = uncompactedLog.trim().split("\n");
            record("j3-persist", "crash-raw-log-lines", { status: 200, body: `lines=${logLines.length}`, headers: {} }, "4 lines (3 enqueues + 1 dequeue)");

            // Start recovery server with unchanged limits
            const recoveryServer = await startServer({}, true, crashDir);
            try {
                record("j3-persist", "recovery-queues", await request(recoveryServer, "/queues", { headers: auth }), '200 ["tasks"]');
                record("j3-persist", "recovery-length", await request(recoveryServer, "/length/tasks", { headers: auth }), "200 2");
                record("j3-persist", "recovery-deq-1", await request(recoveryServer, "/dequeue/tasks", { headers: auth }), '200 "task-2"');
                record("j3-persist", "recovery-deq-2", await request(recoveryServer, "/dequeue/tasks", { headers: auth }), '200 "task-3"');
                record("j3-persist", "recovery-deq-empty", await request(recoveryServer, "/dequeue/tasks", { headers: auth }), "204 No Content");
            } finally {
                await stopServer(recoveryServer, "SIGTERM");
            }
        } finally {
            await Deno.remove(crashDir, { recursive: true }).catch(() => {});
        }

        // Part C: Recovery with corrupt log entries
        console.log("--- Part C: Crash recovery with corrupted lines in persist.dat ---");
        const corruptDir = await Deno.makeTempDir({ prefix: "queue-explore-corrupt-" });
        try {
            const corruptContent = [
                '{"queue":"good","payload":"item-1","enqueue":true,"dequeue":false}',
                'not valid json at all',
                '{"queue":"good","broken":true}',
                '{"queue":"good","payload":"item-2","enqueue":true,"dequeue":false}',
                '{"queue":"good","payload":"ignored","enqueue":false,"dequeue":false}',
                '{"queue":"good","payload":"item-1","enqueue":false,"dequeue":true}',
                '',
            ].join("\n");
            await Deno.writeTextFile(`${corruptDir}/persist.dat`, corruptContent);

            const corruptRecoveryServer = await startServer({}, true, corruptDir);
            try {
                record("j3-persist", "corrupt-recovery-queues", await request(corruptRecoveryServer, "/queues", { headers: auth }), '200 ["good"]');
                record("j3-persist", "corrupt-recovery-length", await request(corruptRecoveryServer, "/length/good", { headers: auth }), "200 1");
                record("j3-persist", "corrupt-recovery-dequeue", await request(corruptRecoveryServer, "/dequeue/good", { headers: auth }), '200 "item-2"');
                record("j3-persist", "corrupt-recovery-drained", await request(corruptRecoveryServer, "/dequeue/good", { headers: auth }), "204 No Content");
            } finally {
                await stopServer(corruptRecoveryServer, "SIGTERM");
            }
        } finally {
            await Deno.remove(corruptDir, { recursive: true }).catch(() => {});
        }

    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
}

async function journey4ConcurrencyAndEdgeCases(): Promise<void> {
    console.log("=== Starting Journey 4: Concurrency, URL Encoding & Boundary Edge Cases ===");
    const server = await startServer({ RATE_LIMIT_REQUESTS: "1000" });
    try {
        const auth = authHeaders();

        // Concurrency test: 50 parallel enqueues across 2 queues
        console.log("--- Testing concurrent enqueues ---");
        const count = 50;
        const enqueuePromises = Array.from({ length: count }, (_, i) => {
            const q = i % 2 === 0 ? "cq1" : "cq2";
            return request(server, `/enqueue/${q}`, postInit(JSON.stringify({ payload: `val-${i}` })));
        });
        const enqueueResults = await Promise.all(enqueuePromises);
        const all200 = enqueueResults.every(r => r.status === 200);
        record("j4-concurrency", "concurrent-50-enqueues", { status: all200 ? 200 : 500, body: `successCount=${enqueueResults.filter(r => r.status === 200).length}`, headers: {} }, "All 50 enqueues return 200");

        const len1 = await request(server, "/length/cq1", { headers: auth });
        const len2 = await request(server, "/length/cq2", { headers: auth });
        record("j4-concurrency", "concurrent-lengths", { status: (len1.body === "25" && len2.body === "25") ? 200 : 500, body: `cq1=${len1.body}, cq2=${len2.body}`, headers: {} }, "cq1 has 25 items, cq2 has 25 items");

        // Concurrent dequeues: 50 parallel dequeues
        console.log("--- Testing concurrent dequeues ---");
        const dequeuePromises1 = Array.from({ length: 25 }, () =>
            request(server, "/dequeue/cq1", { headers: auth })
        );
        const dequeuePromises2 = Array.from({ length: 25 }, () =>
            request(server, "/dequeue/cq2", { headers: auth })
        );
        const [results1, results2] = await Promise.all([
            Promise.all(dequeuePromises1),
            Promise.all(dequeuePromises2),
        ]);

        const allDeq200 = [...results1, ...results2].every(r => r.status === 200);
        const uniqueItems = new Set([...results1, ...results2].map(r => r.body));
        record("j4-concurrency", "concurrent-50-dequeues", { status: (allDeq200 && uniqueItems.size === 50) ? 200 : 500, body: `all200=${allDeq200}, uniqueCount=${uniqueItems.size}`, headers: {} }, "All 50 unique items dequeued without loss or duplicates");

        // URL Percent Encoding Edge Cases
        console.log("--- Testing percent encoding variations ---");
        record("j4-encoding", "space-enqueue", await request(server, "/enqueue/my%20queue", postInit('{"payload":"space-test"}')), "200 OK");
        record("j4-encoding", "space-length", await request(server, "/length/my%20queue", { headers: auth }), "200 1");
        record("j4-encoding", "space-dequeue", await request(server, "/dequeue/my%20queue", { headers: auth }), '200 "space-test"');

        record("j4-encoding", "plus-literal-enqueue", await request(server, "/enqueue/plus+test", postInit('{"payload":"literal-plus"}')), "200 OK");
        record("j4-encoding", "plus-encoded-enqueue", await request(server, "/enqueue/plus%2Btest", postInit('{"payload":"encoded-plus"}')), "200 OK");
        const queuesWithPlus = await request(server, "/queues", { headers: auth });
        record("j4-encoding", "plus-queues-list", queuesWithPlus, "200 with queue 'plus+test' having both items");
        record("j4-encoding", "plus-length", await request(server, "/length/plus+test", { headers: auth }), "200 2");
        await request(server, "/dequeue/plus+test", { headers: auth });
        await request(server, "/dequeue/plus+test", { headers: auth });

        record("j4-encoding", "slash-enqueue", await request(server, "/enqueue/sub%2Fqueue", postInit('{"payload":"slash-test"}')), "200 OK");
        const queuesWithSlash = await request(server, "/queues", { headers: auth });
        record("j4-encoding", "slash-queues-list", queuesWithSlash, '200 ["sub/queue"]');
        record("j4-encoding", "slash-length", await request(server, "/length/sub%2Fqueue", { headers: auth }), "200 1");
        record("j4-encoding", "slash-dequeue", await request(server, "/dequeue/sub%2Fqueue", { headers: auth }), '200 "slash-test"');

        record("j4-encoding", "hash-enqueue", await request(server, "/enqueue/hash%23test", postInit('{"payload":"hash-test"}')), "200 OK");
        record("j4-encoding", "hash-length", await request(server, "/length/hash%23test", { headers: auth }), "200 1");
        record("j4-encoding", "hash-dequeue", await request(server, "/dequeue/hash%23test", { headers: auth }), '200 "hash-test"');

        record("j4-encoding", "question-enqueue", await request(server, "/enqueue/q%3Ftest", postInit('{"payload":"q-test"}')), "200 OK");
        record("j4-encoding", "question-length", await request(server, "/length/q%3Ftest", { headers: auth }), "200 1");
        record("j4-encoding", "question-dequeue", await request(server, "/dequeue/q%3Ftest", { headers: auth }), '200 "q-test"');

        record("j4-encoding", "percent-enqueue", await request(server, "/enqueue/100%25", postInit('{"payload":"percent-test"}')), "200 OK");
        record("j4-encoding", "percent-length", await request(server, "/length/100%25", { headers: auth }), "200 1");
        record("j4-encoding", "percent-dequeue", await request(server, "/dequeue/100%25", { headers: auth }), '200 "percent-test"');

        record("j4-encoding", "null-byte-enqueue", await request(server, "/enqueue/null%00byte", postInit('{"payload":"null-test"}')), "200 OK");
        record("j4-encoding", "null-byte-length", await request(server, "/length/null%00byte", { headers: auth }), "200 1");
        record("j4-encoding", "null-byte-dequeue", await request(server, "/dequeue/null%00byte", { headers: auth }), '200 "null-test"');

        record("j4-encoding", "emoji-enqueue", await request(server, "/enqueue/%F0%9F%94%A5", postInit('{"payload":"fire-test"}')), "200 OK");
        record("j4-encoding", "emoji-length", await request(server, "/length/%F0%9F%94%A5", { headers: auth }), "200 1");
        record("j4-encoding", "emoji-dequeue", await request(server, "/dequeue/%F0%9F%94%A5", { headers: auth }), '200 "fire-test"');

    } finally {
        await stopServer(server);
    }
}

async function main(): Promise<void> {
    try {
        await journey1CoreFifoAndPayloads();
        await journey2ProtocolValidationAndLimits();
        await journey3PersistenceAndRestarts();
        await journey4ConcurrencyAndEdgeCases();
        console.log("\n=== All exploratory journeys completed successfully ===");
    } catch (err) {
        console.error("Exploratory run encountered unexpected failure:", err);
        Deno.exit(1);
    }
}

main();
