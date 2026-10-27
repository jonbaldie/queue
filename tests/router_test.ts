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

Deno.test("Router: dispatches a later method on the same pathname", async () => {
    const router = new Router();
    router.get("/items", () => new Response("get items"));
    router.post("/items", () => new Response("post items"));

    const getRes = await router.handle(new Request("http://localhost/items", { method: "GET" }));
    assertEquals(getRes.status, 200);
    assertEquals(await getRes.text(), "get items");

    const postRes = await router.handle(new Request("http://localhost/items", { method: "POST" }));
    assertEquals(postRes.status, 200);
    assertEquals(await postRes.text(), "post items");
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

Deno.test("Router: HEAD falls back to GET and preserves response metadata without a body", async () => {
    const router = new Router();
    router.get("/items/:id", async (_request, match) => {
        await Promise.resolve();
        return new Response(`item ${match.pathname.groups.id}`, {
            status: 202,
            statusText: "Queued",
            headers: { "X-Item": `${match.pathname.groups.id}` },
        });
    });

    const res = await router.handle(new Request("http://localhost/items/42", { method: "HEAD" }));
    assertEquals(res.status, 202);
    assertEquals(res.statusText, "Queued");
    assertEquals(res.headers.get("X-Item"), "42");
    assertEquals(res.headers.get("Content-Type"), "text/plain;charset=UTF-8");
    assertEquals(res.body, null);
    assertEquals(await res.text(), "");
});

for (const headFirst of [false, true]) {
    Deno.test(`Router: explicit HEAD wins with HEAD registered ${headFirst ? "first" : "last"}`, async () => {
        const router = new Router();
        const items = ["oldest", "newest"];
        const registerGet = () => router.get("/items/:id", () => new Response(items.shift()));
        const registerHead = () => router.head("/items/:id", async (_request, match) => {
            await Promise.resolve();
            return new Response(items[0], {
                status: 202,
                statusText: "Peeked",
                headers: { "X-Item": `${match.pathname.groups.id}` },
            });
        });
        if (headFirst) {
            registerHead();
            registerGet();
        } else {
            registerGet();
            registerHead();
        }

        const head = await router.handle(new Request("http://localhost/items/42", { method: "HEAD" }));
        assertEquals(head.status, 202);
        assertEquals(head.statusText, "Peeked");
        assertEquals(head.headers.get("X-Item"), "42");
        assertEquals(head.body, null);
        assertEquals(await head.text(), "");
        assertEquals(items, ["oldest", "newest"]);

        const get = await router.handle(new Request("http://localhost/items/42"));
        assertEquals(await get.text(), "oldest");
        assertEquals(items, ["newest"]);
    });
}

Deno.test("Router: explicit HEAD wins over an earlier overlapping GET pattern", async () => {
    const router = new Router();
    router.get("/items/:id", () => new Response("get"));
    router.head("/items/special", () => new Response("head", { status: 202 }));

    const res = await router.handle(new Request("http://localhost/items/special", { method: "HEAD" }));
    assertEquals(res.status, 202);
    assertEquals(res.body, null);
});

Deno.test("Router: HEAD fallback keeps the first matching GET and ignores unrelated HEAD routes", async () => {
    const router = new Router();
    router.get("/items", () => new Response("first", { status: 202 }));
    router.get("/items", () => new Response("second", { status: 203 }));
    router.head("/other", () => new Response("other", { status: 201 }));

    const res = await router.handle(new Request("http://localhost/items", { method: "HEAD" }));
    assertEquals(res.status, 202);
    assertEquals(res.body, null);
});

Deno.test("Router: a HEAD-only route strips its body and advertises HEAD for other methods", async () => {
    const router = new Router();
    router.head("/items", () => new Response("first", { status: 202 }));
    router.head("/items", () => new Response("second", { status: 203 }));

    const head = await router.handle(new Request("http://localhost/items", { method: "HEAD" }));
    assertEquals(head.status, 202);
    assertEquals(head.body, null);

    const get = await router.handle(new Request("http://localhost/items"));
    assertEquals(get.status, 405);
    assertEquals(get.headers.get("Allow"), "HEAD");
    assertEquals(await get.text(), "Method not allowed");
});

for (const headFirst of [false, true]) {
    Deno.test(`Router: explicit HEAD preserves Allow order with HEAD registered ${headFirst ? "first" : "last"}`, async () => {
        const router = new Router();
        const registerHead = () => router.head("/items", () => new Response("head"));
        if (headFirst) registerHead();
        router.post("/items", () => new Response("post"));
        router.get("/items", () => new Response("get"));
        if (!headFirst) registerHead();

        const res = await router.handle(new Request("http://localhost/items", { method: "DELETE" }));
        assertEquals(res.status, 405);
        assertEquals(res.headers.get("Allow"), "POST, GET");
        assertEquals(await res.text(), "Method not allowed");
    });
}

Deno.test("Router: HEAD to a POST-only route returns 405", async () => {
    const router = new Router();
    router.post("/items", () => new Response("post"));

    const res = await router.handle(new Request("http://localhost/items", { method: "HEAD" }));
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "POST");
});

Deno.test("Router: HEAD to an unknown path returns 404", async () => {
    const router = new Router();
    router.get("/items", () => new Response("get"));

    const res = await router.handle(new Request("http://localhost/missing", { method: "HEAD" }));
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
