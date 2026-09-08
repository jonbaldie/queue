import { assertEquals } from "jsr:@std/assert@1.0";
import { Router } from "../src/router.ts";

Deno.test("Router: 405 response on single-method GET route includes Allow: GET", async () => {
    const router = new Router();
    router.get("/queues", () => new Response("ok"));

    const res = await router.handle(new Request("http://localhost/queues", { method: "POST" }));
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "GET");
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("Router: 405 response on single-method POST route includes Allow: POST", async () => {
    const router = new Router();
    router.post("/enqueue/:queue", () => new Response("ok"));

    const res = await router.handle(new Request("http://localhost/enqueue/test", { method: "GET" }));
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "POST");
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("Router: 405 response on multi-method route includes all allowed methods", async () => {
    const router = new Router();
    router.get("/items", () => new Response("get"));
    router.post("/items", () => new Response("post"));

    const res = await router.handle(new Request("http://localhost/items", { method: "DELETE" }));
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "GET, POST");
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("Router: 405 response on multi-method route preserves registration order in Allow header", async () => {
    const router = new Router();
    router.post("/items", () => new Response("post"));
    router.get("/items", () => new Response("get"));

    const res = await router.handle(new Request("http://localhost/items", { method: "DELETE" }));
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "POST, GET");
});

Deno.test("Router: 405 response deduplicates repeated methods in Allow header", async () => {
    const router = new Router();
    router.get("/dup", () => new Response("first"));
    router.get("/dup", () => new Response("second"));

    const res = await router.handle(new Request("http://localhost/dup", { method: "POST" }));
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "GET");
});

Deno.test("Router: 404 response for nonexistent route does not include Allow header", async () => {
    const router = new Router();
    router.get("/queues", () => new Response("ok"));

    const res = await router.handle(new Request("http://localhost/nonexistent", { method: "GET" }));
    assertEquals(res.status, 404);
    assertEquals(res.headers.get("Allow"), null);
});

Deno.test("Router: 200 response on supported method does not include Allow header", async () => {
    const router = new Router();
    router.get("/queues", () => new Response("ok"));

    const res = await router.handle(new Request("http://localhost/queues", { method: "GET" }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Allow"), null);
});
