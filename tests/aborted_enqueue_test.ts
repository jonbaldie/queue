import { assertEquals, assertMatch } from "jsr:@std/assert@1.0";
import { createHandler } from "../src/handler.ts";
import QueueManager from "../src/manager.ts";
import { MemoryStore } from "../src/persist.ts";
import type { Payload } from "../src/payload.ts";

Deno.test("aborted enqueue returns 400, leaves queue empty, and permits retry", async () => {
    const handler = createHandler(new QueueManager<Payload>(new MemoryStore<Payload>()), "test-token");
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
    const port = server.addr.port;
    const conn = await Deno.connect({ hostname: "127.0.0.1", port });
    try {
        const request = new TextEncoder().encode(
            "POST /enqueue/drop HTTP/1.1\r\n" +
            `Host: 127.0.0.1:${port}\r\n` +
            "Authorization: Bearer test-token\r\n" +
            "Content-Type: application/json\r\n" +
            "Content-Length: 40\r\n" +
            "Connection: close\r\n\r\n" +
            '{"payload":',
        );
        let written = 0;
        while (written < request.length) written += await conn.write(request.subarray(written));
        await conn.closeWrite();
        let response = "";
        const buffer = new Uint8Array(4096);
        const decoder = new TextDecoder();
        for (;;) {
            const count = await conn.read(buffer);
            if (count === null) break;
            response += decoder.decode(buffer.subarray(0, count), { stream: true });
        }
        assertMatch(response, /^HTTP\/1\.1 400 /);

        const base = `http://127.0.0.1:${port}`;
        const headers = { Authorization: "Bearer test-token" };
        const length = await fetch(`${base}/length/drop`, { headers });
        assertEquals(await length.json(), 0);
        const retry = await fetch(`${base}/enqueue/drop`, {
            method: "POST", headers, body: JSON.stringify({ payload: "retry-ok" }),
        });
        assertEquals(retry.status, 200);
        await retry.body?.cancel();
        const dequeue = await fetch(`${base}/dequeue/drop`, { headers });
        assertEquals(await dequeue.json(), "retry-ok");
    } finally {
        conn.close();
        await server.shutdown();
    }
});
