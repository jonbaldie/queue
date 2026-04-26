import { assertEquals } from "jsr:@std/assert";
import * as Persistency from "../src/persist.ts";
import QueueManager from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";

const TEST_TOKEN = "test-secret-token";

function makeHandler() {
    const mgr = new QueueManager(new Persistency.None);
    return createHandler(mgr, TEST_TOKEN);
}

Deno.test("auth: no token on enqueue returns 401", async () => {
    const handler = makeHandler();
    const req = new Request("http://localhost/enqueue/foo", {
        method: "POST",
        body: JSON.stringify({ payload: "bar" }),
        headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: no token on dequeue returns 401", async () => {
    const handler = makeHandler();
    const req = new Request("http://localhost/dequeue/foo");
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: no token on length returns 401", async () => {
    const handler = makeHandler();
    const req = new Request("http://localhost/length/foo");
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: wrong token on enqueue returns 401", async () => {
    const handler = makeHandler();
    const req = new Request("http://localhost/enqueue/foo", {
        method: "POST",
        body: JSON.stringify({ payload: "bar" }),
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer wrong-token",
        },
    });
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: wrong token on dequeue returns 401", async () => {
    const handler = makeHandler();
    const req = new Request("http://localhost/dequeue/foo", {
        headers: { "Authorization": "Bearer wrong-token" },
    });
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: wrong token on length returns 401", async () => {
    const handler = makeHandler();
    const req = new Request("http://localhost/length/foo", {
        headers: { "Authorization": "Bearer wrong-token" },
    });
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: valid token on enqueue returns 200", async () => {
    const handler = makeHandler();
    const req = new Request("http://localhost/enqueue/foo", {
        method: "POST",
        body: JSON.stringify({ payload: "bar" }),
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${TEST_TOKEN}`,
        },
    });
    const res = await handler(req);
    assertEquals(200, res.status);
});

Deno.test("auth: valid token on dequeue returns 200", async () => {
    const handler = makeHandler();
    const enqReq = new Request("http://localhost/enqueue/foo", {
        method: "POST",
        body: JSON.stringify({ payload: "bar" }),
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${TEST_TOKEN}`,
        },
    });
    await handler(enqReq);

    const deqReq = new Request("http://localhost/dequeue/foo", {
        headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
    });
    const res = await handler(deqReq);
    assertEquals(200, res.status);
});

Deno.test("auth: valid token on length returns 200", async () => {
    const handler = makeHandler();
    const req = new Request("http://localhost/length/foo", {
        headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
    });
    const res = await handler(req);
    assertEquals(200, res.status);
});
