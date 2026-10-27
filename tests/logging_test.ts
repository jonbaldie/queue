import { assertEquals, assertMatch, assertRejects, assertStrictEquals } from "jsr:@std/assert@1.0";
import { createHandler } from "../src/handler.ts";
import QueueManager from "../src/manager.ts";
import { MemoryStore } from "../src/persist.ts";
import type { Payload } from "../src/payload.ts";
import { withLogging } from "../src/middleware.ts";

Deno.test("logging: a custom sink records health, auth, and rate-limit responses", async () => {
    const records: { message: string; isError: boolean | undefined }[] = [];
    const sink = {
        write(message: string, isError?: boolean) {
            records.push({ message, isError });
        },
    };
    const manager = new QueueManager<Payload>(new MemoryStore<Payload>());
    const handler = createHandler(manager, "token", 1, sink);
    const requests = [
        new Request("http://localhost/health"),
        new Request("http://localhost/queues"),
        new Request("http://localhost/queues", {
            headers: { Authorization: "Bearer token" },
        }),
        new Request("http://localhost/health/"),
    ];
    const statuses = [];
    for (const request of requests) {
        const response = await handler(request);
        statuses.push(response.status);
        await response.body?.cancel();
    }
    assertEquals(statuses, [200, 401, 429, 200]);
    assertEquals(records.map(({ message, isError }) => {
        assertMatch(message, / \d+\.\d{2}ms$/);
        return { message: message.replace(/ \d+\.\d{2}ms$/, ""), isError };
    }), [
        { message: "GET http://localhost/health 200", isError: false },
        { message: "GET http://localhost/queues 401", isError: false },
        { message: "GET http://localhost/queues 429", isError: false },
        { message: "GET http://localhost/health/ 200", isError: false },
    ]);
});

Deno.test("logging: middleware forwards request and server info and preserves the response", async () => {
    const messages: string[] = [];
    const request = new Request("http://localhost/enqueue/jobs", { method: "POST" });
    const info: Deno.ServeHandlerInfo = {
        remoteAddr: { transport: "tcp", hostname: "192.0.2.1", port: 1234 },
        completed: Promise.resolve(),
    };
    const response = new Response("created", { status: 201, headers: { "X-Queue": "jobs" } });
    const handler = withLogging({
        write(message, isError) {
            assertEquals(isError, false);
            messages.push(message);
        },
    })((receivedRequest, receivedInfo) => {
        assertStrictEquals(receivedRequest, request);
        assertStrictEquals(receivedInfo, info);
        return response;
    });
    assertStrictEquals(await handler(request, info), response);
    assertEquals(await response.text(), "created");
    assertEquals(response.headers.get("X-Queue"), "jobs");
    assertEquals(messages.length, 1);
    assertMatch(messages[0], /^POST http:\/\/localhost\/enqueue\/jobs 201 \d+\.\d{2}ms$/);
});

Deno.test("logging: synchronous throws and async rejections log 500 and retain the error", async () => {
    const failure = new Error("queue unavailable");
    for (const next of [() => { throw failure; }, async () => { throw failure; }]) {
        const records: { message: string; isError: boolean | undefined }[] = [];
        const handler = withLogging({
            write(message, isError) {
                records.push({ message, isError });
            },
        })(next);
        const caught = await assertRejects(
            async () => await handler(new Request("http://localhost/queues")),
            Error,
            "queue unavailable",
        );
        assertStrictEquals(caught, failure);
        assertEquals(records.length, 1);
        assertEquals(records[0].isError, true);
        assertMatch(records[0].message, /^GET http:\/\/localhost\/queues 500 \d+\.\d{2}ms$/);
    }
});

Deno.test("logging: default sink writes UTF-8 lines to stdout and errors to stderr", async () => {
    const moduleUrl = new URL("../src/middleware.ts", import.meta.url).href;
    const result = await new Deno.Command(Deno.execPath(), {
        args: ["eval", `
            import { DEFAULT_CONSOLE_SINK, withLogging } from ${JSON.stringify(moduleUrl)};
            DEFAULT_CONSOLE_SINK.write("Queue café");
            DEFAULT_CONSOLE_SINK.write("Queue failed", true);
            const request = new Request("http://localhost/queues");
            await withLogging()(() => new Response("failed", { status: 500 }))(request);
            try {
                await withLogging()(() => { throw new Error("unavailable"); })(request);
            } catch (error) {
                if (error.message !== "unavailable") throw error;
            }
        `],
    }).output();
    assertEquals(result.code, 0);
    const decoder = new TextDecoder();
    assertMatch(decoder.decode(result.stdout), /^Queue café\nGET http:\/\/localhost\/queues 500 \d+\.\d{2}ms\n$/);
    assertMatch(decoder.decode(result.stderr), /^Queue failed\nGET http:\/\/localhost\/queues 500 \d+\.\d{2}ms\n$/);
});

Deno.test("logging: a silent sink leaves process streams empty and HTTP responses intact", async () => {
    const handlerUrl = new URL("../src/handler.ts", import.meta.url).href;
    const managerUrl = new URL("../src/manager.ts", import.meta.url).href;
    const persistUrl = new URL("../src/persist.ts", import.meta.url).href;
    const result = await new Deno.Command(Deno.execPath(), {
        args: ["eval", `
            import { createHandler } from ${JSON.stringify(handlerUrl)};
            import QueueManager from ${JSON.stringify(managerUrl)};
            import { MemoryStore } from ${JSON.stringify(persistUrl)};
            const handler = createHandler(new QueueManager(new MemoryStore()), "token", 100, { write() {} });
            const response = await handler(new Request("http://localhost/health"));
            if (response.status !== 200 || (await response.json()).status !== "ok") {
                throw new Error("Health response changed");
            }
        `],
    }).output();
    assertEquals(result.code, 0);
    assertEquals(new TextDecoder().decode(result.stdout), "");
    assertEquals(new TextDecoder().decode(result.stderr), "");
});
