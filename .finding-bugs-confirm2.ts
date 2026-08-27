import QueueManager from "./src/manager.ts";
import { createHandler } from "./src/handler.ts";
import { FileStore, MemoryStore } from "./src/persist.ts";

const TOKEN = "t";
const AUTH = { Authorization: "Bearer t", "Content-Type": "application/json" };

function report(name: string, ok: boolean, detail: unknown): void {
    console.log(JSON.stringify({ name, ok, detail }));
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 1);
    const handler = createHandler(manager, TOKEN, 1000);
    const peek = await handler(new Request("http://127.0.0.1/peek/ghost", { headers: AUTH }));
    const queues = await handler(new Request("http://127.0.0.1/queues", { headers: AUTH }));
    report("peek-unknown-does-not-create", peek.status === 204 && JSON.stringify(await queues.json()) === "[]", {
        peekStatus: peek.status,
    });
}

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

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const enq = await handler(new Request("http://127.0.0.1/enqueue/q", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: [] }),
    }));
    const deq = await handler(new Request("http://127.0.0.1/dequeue/q", { headers: AUTH }));
    const body = await deq.text();
    report("empty-array-payload-roundtrip", enq.status === 200 && deq.status === 200 && body === "[]", {
        enq: enq.status,
        deq: deq.status,
        body,
    });
}

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

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const response = await handler(new Request("http://127.0.0.1/health/"));
    report("health-trailing-slash", response.status === 404 || response.status === 200, {
        status: response.status,
        body: await response.text(),
    });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const response = await handler(new Request("http://127.0.0.1/enqueue/", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: "x" }),
    }));
    report("empty-queue-name", response.status === 404 || response.status === 400 || response.status === 200, {
        status: response.status,
        body: await response.text(),
    });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 3);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
        const response = await handler(new Request("http://127.0.0.1/health"));
        statuses.push(response.status);
        await response.body?.cancel();
    }
    report("health-bypasses-rate-limit", statuses.every((status) => status === 200), { statuses });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const response = await handler(new Request("http://127.0.0.1/enqueue/q", {
        method: "POST",
        headers: { Authorization: "bearer t", "Content-Type": "application/json" },
        body: JSON.stringify({ payload: "x" }),
    }));
    report("bearer-scheme-is-exact", response.status === 401 || response.status === 200, {
        status: response.status,
        body: await response.text(),
    });
}

{
    const directory = await Deno.makeTempDir();
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts", "--persist"],
        cwd: Deno.cwd(),
        env: {
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: directory,
            QUEUE_API_TOKEN: "t",
            QUEUE_DEPTH_LIMIT: "1",
        },
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    await Deno.writeTextFile(
        directory + "/persist.dat",
        JSON.stringify({ queue: "jobs", payload: "a", enqueue: true, dequeue: false }) + "\n" +
        JSON.stringify({ queue: "jobs", payload: "b", enqueue: true, dequeue: false }) + "\n",
    );
    // rewrite after spawn races; write BEFORE spawn instead - this process already started.
    // kill and use a dedicated startup below
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    await child.status.catch(() => undefined);
    await Deno.remove(directory, { recursive: true });
}

{
    const directory = await Deno.makeTempDir();
    await Deno.writeTextFile(
        directory + "/persist.dat",
        JSON.stringify({ queue: "jobs", payload: "a", enqueue: true, dequeue: false }) + "\n" +
        JSON.stringify({ queue: "jobs", payload: "b", enqueue: true, dequeue: false }) + "\n",
    );
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts", "--persist"],
        cwd: Deno.cwd(),
        env: {
            HOST: "127.0.0.1",
            PORT: "0",
            PERSIST: directory,
            QUEUE_API_TOKEN: "t",
            QUEUE_DEPTH_LIMIT: "1",
            RATE_LIMIT_REQUESTS: "1000",
        },
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    const decoder = new TextDecoder();
    const stdout = child.stdout.getReader();
    const stderr = child.stderr.getReader();
    let out = "";
    let err = "";
    const result = await Promise.race([
        child.status.then((status) => ({ kind: "exit" as const, status })),
        (async () => {
            while (true) {
                const { done, value } = await stdout.read();
                if (done) break;
                out += decoder.decode(value, { stream: true });
                if (out.includes("Listening on")) return { kind: "listening" as const };
            }
            return { kind: "closed" as const };
        })(),
        new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 2000)),
    ]);
    try {
        const errRead = await Promise.race([
            stderr.read(),
            new Promise<{ done: true; value: undefined }>((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), 200)),
        ]);
        if (errRead.value) err += decoder.decode(errRead.value);
    } catch { /* ignore */ }
    report("main-persist-over-depth-does-not-listen", result.kind !== "listening", { result, out, err });
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    await child.status.catch(() => undefined);
    await stdout.cancel().catch(() => undefined);
    await stderr.cancel().catch(() => undefined);
    await Deno.remove(directory, { recursive: true });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    const encoded = encodeURIComponent("q/a");
    const response = await handler(new Request(`http://127.0.0.1/enqueue/${encoded}`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: "x" }),
    }));
    const queues = await handler(new Request("http://127.0.0.1/queues", { headers: AUTH }));
    report("encoded-slash-queue-name", response.status === 200 || response.status === 404 || response.status === 400, {
        status: response.status,
        body: await response.text(),
        queues: await queues.json(),
    });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 2, 10);
    const handler = createHandler(manager, TOKEN, 1000);
    await handler(new Request("http://127.0.0.1/enqueue/q", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: "a" }),
    }));
    await handler(new Request("http://127.0.0.1/enqueue/q", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: "b" }),
    }));
    const overflow = await handler(new Request("http://127.0.0.1/enqueue/q", {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ payload: "c" }),
    }));
    const length = await handler(new Request("http://127.0.0.1/length/q", { headers: AUTH }));
    const first = await handler(new Request("http://127.0.0.1/dequeue/q", { headers: AUTH }));
    report("overflow-does-not-mutate-fifo", overflow.status === 507 && await length.text() === "2" && await first.text() === "a", {
        overflow: overflow.status,
    });
}

{
    const directory = await Deno.makeTempDir();
    await Deno.writeTextFile(directory + "/persist.dat", "\n\n");
    const store = new FileStore<string>();
    store.dir(directory);
    const manager = new QueueManager<string>(store, 10, 10);
    try {
        manager.load();
        report("blank-persist-loads-empty", manager.listQueues().length === 0, { queues: manager.listQueues() });
    } catch (error) {
        report("blank-persist-loads-empty", false, { threw: String(error) });
    }
    await Deno.remove(directory, { recursive: true });
}

{
    const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
    const handler = createHandler(manager, "", 1000);
    const none = await handler(new Request("http://127.0.0.1/queues"));
    const emptyBearer = await handler(new Request("http://127.0.0.1/queues", {
        headers: { Authorization: "Bearer " },
    }));
    report("empty-api-token-does-not-auth-empty-bearer", emptyBearer.status === 401, {
        none: none.status,
        emptyBearer: emptyBearer.status,
    });
}
