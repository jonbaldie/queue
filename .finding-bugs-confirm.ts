import QueueManager from "./src/manager.ts";
import { createHandler } from "./src/handler.ts";
import { FileStore, MemoryStore } from "./src/persist.ts";

const TOKEN = "t";
const AUTH = { Authorization: "Bearer t", "Content-Type": "application/json" };

function report(name: string, ok: boolean, detail: unknown): void {
    console.log(JSON.stringify({ name, ok, detail }));
}

// 1. Persist load ignores queue count limit
{
    const directory = await Deno.makeTempDir();
    const store = new FileStore<string>();
    store.dir(directory);
    store.saveEvent("one", "a", true);
    store.saveEvent("two", "b", true);
    const manager = new QueueManager<string>(store, 10, 1);
    manager.load();
    report("persist-load-respects-count-limit", manager.listQueues().length <= 1, {
        queues: manager.listQueues(),
        limit: 1,
    });
    await Deno.remove(directory, { recursive: true });
}

// 2. Persist load throws when depth limit is lower than the log
{
    const directory = await Deno.makeTempDir();
    const store = new FileStore<string>();
    store.dir(directory);
    store.saveEvent("jobs", "a", true);
    store.saveEvent("jobs", "b", true);
    const manager = new QueueManager<string>(store, 1, 10);
    let threw = "";
    try {
        manager.load();
    } catch (error) {
        threw = String(error);
    }
    report("persist-load-respects-depth-limit", threw === "" && manager.length("jobs") <= 1, {
        threw,
        length: threw === "" ? manager.length("jobs") : null,
    });
    await Deno.remove(directory, { recursive: true });
}

// 3. Missing persist directory
{
    const directory = await Deno.makeTempDir();
    const store = new FileStore<string>();
    store.dir(directory + "/missing");
    const manager = new QueueManager<string>(store, 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    try {
        const response = await handler(new Request("http://127.0.0.1/enqueue/q", {
            method: "POST",
            headers: AUTH,
            body: JSON.stringify({ payload: "x" }),
        }));
        report("missing-persist-dir-is-not-500", response.status < 500, {
            status: response.status,
            body: await response.text(),
        });
    } catch (error) {
        report("missing-persist-dir-is-not-500", false, { threw: String(error) });
    }
    await Deno.remove(directory, { recursive: true });
}

// 4. X-Forwarded-For bypass
{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 2);
    const info = {
        remoteAddr: { transport: "tcp" as const, hostname: "198.51.100.9", port: 9 },
        completed: Promise.resolve(),
    };
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
        const response = await handler(new Request("http://127.0.0.1/queues", {
            headers: { ...AUTH, "x-forwarded-for": `203.0.113.${i}` },
        }), info);
        statuses.push(response.status);
        await response.body?.cancel();
    }
    report("x-forwarded-for-cannot-bypass-rate-limit", statuses.includes(429), { statuses, limit: 2 });
}

// 5. Length of unknown queue creates it and consumes a slot
{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 1);
    const handler = createHandler(manager, TOKEN, 1000);
    const lengthRes = await handler(new Request("http://127.0.0.1/length/ghost", { headers: AUTH }));
    const queuesRes = await handler(new Request("http://127.0.0.1/queues", { headers: AUTH }));
    const enqueueRes = await handler(new Request("http://127.0.0.1/enqueue/real", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: "work" }),
    }));
    report("reads-do-not-consume-queue-slots", enqueueRes.status === 200, {
        lengthStatus: lengthRes.status,
        lengthBody: await lengthRes.text(),
        queues: await queuesRes.json(),
        enqueueStatus: enqueueRes.status,
        enqueueBody: await enqueueRes.text(),
    });
}

// 6. Dequeue of unknown queue creates it
{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 1);
    const handler = createHandler(manager, TOKEN, 1000);
    const dequeueRes = await handler(new Request("http://127.0.0.1/dequeue/ghost", { headers: AUTH }));
    const queuesRes = await handler(new Request("http://127.0.0.1/queues", { headers: AUTH }));
    const enqueueRes = await handler(new Request("http://127.0.0.1/enqueue/real", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: "work" }),
    }));
    report("dequeue-unknown-does-not-consume-slot", enqueueRes.status === 200, {
        dequeueStatus: dequeueRes.status,
        queues: await queuesRes.json(),
        enqueueStatus: enqueueRes.status,
    });
}

// 7. Peek of unknown does not create
{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 1);
    const handler = createHandler(manager, TOKEN, 1000);
    await handler(new Request("http://127.0.0.1/peek/ghost", { headers: AUTH }));
    const queuesRes = await handler(new Request("http://127.0.0.1/queues", { headers: AUTH }));
    report("peek-unknown-does-not-create", (await queuesRes.json() as string[]).length === 0, {
        queues: await queuesRes.clone().json().catch(() => "already-read"),
    });
}

// 8. Malformed persist line
{
    const directory = await Deno.makeTempDir();
    await Deno.writeTextFile(directory + "/persist.dat", "{not json\n");
    const store = new FileStore<string>();
    store.dir(directory);
    const manager = new QueueManager<string>(store, 10, 10);
    try {
        manager.load();
        report("malformed-persist-is-not-throw", true, { queues: manager.listQueues() });
    } catch (error) {
        report("malformed-persist-is-not-throw", false, { threw: String(error) });
    }
    await Deno.remove(directory, { recursive: true });
}

// 9. Content-Length junk still 413/400 not throw
{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    try {
        const response = await handler(new Request("http://127.0.0.1/enqueue/q", {
            method: "POST",
            headers: { ...AUTH, "content-length": "1x" },
            body: JSON.stringify({ payload: "x" }),
        }));
        report("junk-content-length-is-client-error", response.status < 500, {
            status: response.status,
            body: await response.text(),
        });
    } catch (error) {
        report("junk-content-length-is-client-error", false, { threw: String(error) });
    }
}

// 10. Empty array payload roundtrip
{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    await handler(new Request("http://127.0.0.1/enqueue/q", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: [] }),
    }));
    const response = await handler(new Request("http://127.0.0.1/dequeue/q", { headers: AUTH }));
    report("empty-array-payload-roundtrip", response.status === 200 && await response.text() === "[]", {
        status: response.status,
    });
}

// 11. Persist FIFO of mixed types after save/load
{
    const directory = await Deno.makeTempDir();
    const store = new FileStore();
    store.dir(directory);
    const manager = new QueueManager(store, 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    for (const payload of [0, false, "", { a: 1 }, [1]]) {
        await handler(new Request("http://127.0.0.1/enqueue/mix", {
            method: "POST",
            headers: AUTH,
            body: JSON.stringify({ payload }),
        }));
    }
    manager.save();
    const store2 = new FileStore();
    store2.dir(directory);
    const manager2 = new QueueManager(store2, 10, 10);
    manager2.load();
    const handler2 = createHandler(manager2, TOKEN, 1000);
    const got: string[] = [];
    for (let i = 0; i < 5; i++) {
        const response = await handler2(new Request("http://127.0.0.1/dequeue/mix", { headers: AUTH }));
        got.push(`${response.status}:${await response.text()}`);
    }
    report("persist-mixed-payload-fifo", JSON.stringify(got) === JSON.stringify([
        "200:0",
        "200:false",
        "200:",
        "200:{\"a\":1}",
        "200:[1]",
    ]), { got });
    await Deno.remove(directory, { recursive: true });
}

// 12. Health trailing slash is not authenticated leak / crash
{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const response = await handler(new Request("http://127.0.0.1/health/"));
    report("health-trailing-slash", response.status === 404 || response.status === 200, {
        status: response.status,
        body: await response.text(),
    });
}
