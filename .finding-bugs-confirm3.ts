import QueueManager from "./src/manager.ts";
import { createHandler } from "./src/handler.ts";
import { FileStore, MemoryStore } from "./src/persist.ts";
import { parseConfig } from "./src/config.ts";

const TOKEN = "t";
const AUTH = { Authorization: "Bearer t", "Content-Type": "application/json" };

function report(name: string, ok: boolean, detail: unknown): void {
    console.log(JSON.stringify({ name, ok, detail }));
}

{
    const directory = await Deno.makeTempDir();
    await Deno.writeTextFile(
        directory + "/persist.dat",
        JSON.stringify({ queue: "q", enqueue: true, dequeue: false }) + "\n",
    );
    const store = new FileStore();
    store.dir(directory);
    const manager = new QueueManager(store, 10, 10);
    try {
        manager.load();
        const handler = createHandler(manager, TOKEN, 1000);
        const response = await handler(new Request("http://127.0.0.1/dequeue/q", { headers: AUTH }));
        report("persist-event-missing-payload", response.status === 204 || response.status === 200, {
            status: response.status,
            body: await response.text(),
            queues: manager.listQueues(),
        });
    } catch (error) {
        report("persist-event-missing-payload", false, { threw: String(error) });
    }
    await Deno.remove(directory, { recursive: true });
}

{
    const directory = await Deno.makeTempDir();
    await Deno.writeTextFile(
        directory + "/persist.dat",
        JSON.stringify({ queue: "q", payload: "x", enqueue: true, dequeue: true }) + "\n",
    );
    const store = new FileStore();
    store.dir(directory);
    const manager = new QueueManager(store, 10, 10);
    manager.load();
    report("persist-event-both-flags", true, {
        queues: manager.listQueues(),
        length: manager.length("q"),
    });
    await Deno.remove(directory, { recursive: true });
}

{
    const directory = await Deno.makeTempDir();
    const store = new FileStore();
    store.dir(directory);
    const manager = new QueueManager(store, 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const payload = "héllo 👋 " + "x".repeat(100);
    await handler(new Request("http://127.0.0.1/enqueue/u", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload }),
    }));
    manager.save();
    const store2 = new FileStore();
    store2.dir(directory);
    const manager2 = new QueueManager(store2, 10, 10);
    manager2.load();
    const handler2 = createHandler(manager2, TOKEN, 1000);
    const response = await handler2(new Request("http://127.0.0.1/dequeue/u", { headers: AUTH }));
    const body = await response.text();
    report("persist-unicode-roundtrip", body === payload, { body, payload, status: response.status });
    await Deno.remove(directory, { recursive: true });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const name = "x".repeat(128);
    const ok = await handler(new Request(`http://127.0.0.1/enqueue/${name}`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: "x" }),
    }));
    const tooLong = await handler(new Request(`http://127.0.0.1/enqueue/${name}y`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: "x" }),
    }));
    report("queue-name-128-ok-129-bad", ok.status === 200 && tooLong.status === 400, {
        ok: ok.status,
        tooLong: tooLong.status,
        tooLongBody: await tooLong.text(),
    });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const response = await handler(new Request("http://127.0.0.1/enqueue/q", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: { n: 1 }, extra: "ignored" }),
    }));
    const deq = await handler(new Request("http://127.0.0.1/dequeue/q", { headers: AUTH }));
    report("extra-keys-ignored", response.status === 200 && await deq.text() === '{"n":1}', {
        status: response.status,
    });
}

{
    try {
        const config = parseConfig({ PORT: "65535" }, []);
        report("port-65535-ok", config.port === 65535, config);
    } catch (error) {
        report("port-65535-ok", false, { threw: String(error) });
    }
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const response = await handler(new Request("http://127.0.0.1/enqueue/q", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: { payload: "nested" } }),
    }));
    const deq = await handler(new Request("http://127.0.0.1/dequeue/q", { headers: AUTH }));
    report("nested-payload-key", response.status === 200 && await deq.text() === '{"payload":"nested"}', {
        status: response.status,
    });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1);
    const info = {
        remoteAddr: { transport: "tcp" as const, hostname: "192.0.2.1", port: 1 },
        completed: Promise.resolve(),
    };
    const first = await handler(new Request("http://127.0.0.1/queues", { headers: AUTH }), info);
    const second = await handler(new Request("http://127.0.0.1/queues", { headers: AUTH }), info);
    report("same-ip-without-xff-is-limited", first.status === 200 && second.status === 429, {
        first: first.status,
        second: second.status,
    });
}

{
    const directory = await Deno.makeTempDir();
    const store = new FileStore<string>();
    store.dir(directory);
    const manager = new QueueManager<string>(store, 10, 10);
    manager.enqueue("a", "1");
    manager.enqueue("a", "2");
    manager.dequeue("a");
    manager.save();
    const store2 = new FileStore<string>();
    store2.dir(directory);
    const manager2 = new QueueManager<string>(store2, 10, 10);
    manager2.load();
    report("save-compacts-to-remaining-items", manager2.length("a") === 1 && manager2.dequeue("a") === "2", {
        length: manager2.length("a"),
        item: manager2.peek("a"),
        queues: manager2.listQueues(),
    });
    await Deno.remove(directory, { recursive: true });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const response = await handler(new Request("http://127.0.0.1/enqueue/q", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ Payload: "x" }),
    }));
    report("payload-key-is-case-sensitive", response.status === 400, {
        status: response.status,
        body: await response.text(),
    });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const response = await handler(new Request("http://127.0.0.1/length/q", {
        method: "HEAD",
        headers: AUTH,
    }));
    report("head-length-is-405-or-404", response.status === 405 || response.status === 404, {
        status: response.status,
        body: await response.text(),
    });
}
