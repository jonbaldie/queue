const REPO_DIR = Deno.cwd();
const TOKEN = "explore-token-20260910";
const MAX_BODY_SIZE = 1024 * 1024;

type ResponseSummary = {
    status: number;
    body: string;
    headers: Record<string, string>;
};

type RunningServer = {
    child: Deno.ChildProcess;
    persistDir: string;
    port: number;
    stdout: string;
    stderr: string;
    stdoutTask: Promise<void>;
    stderrTask: Promise<void>;
};

function compactBody(body: string): string {
    if (body.length <= 240) return body;
    return `${body.slice(0, 240)}… (${body.length} characters)`;
}

function selectedHeaders(headers: Headers): Record<string, string> {
    const selected: Record<string, string> = {};
    for (const name of ["allow", "content-length", "content-type", "www-authenticate"]) {
        const value = headers.get(name);
        if (value !== null) selected[name] = value;
    }
    return selected;
}

async function request(
    server: RunningServer,
    pathname: string,
    init: RequestInit = {},
): Promise<ResponseSummary> {
    const response = await fetch(`http://127.0.0.1:${server.port}${pathname}`, init);
    const body = await response.text();
    return {
        status: response.status,
        body: compactBody(body),
        headers: selectedHeaders(response.headers),
    };
}

function authHeaders(contentType = false): Record<string, string> {
    return contentType
        ? { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
        : { Authorization: `Bearer ${TOKEN}` };
}

function postInit(body: string): RequestInit {
    return {
        method: "POST",
        headers: authHeaders(true),
        body,
    };
}

function record(journey: string, name: string, result: ResponseSummary, expectation: string): void {
    console.log(JSON.stringify({ journey, name, result, expectation }));
}

async function startServer(
    extraEnv: Record<string, string> = {},
    persist = false,
    persistDir = "",
): Promise<RunningServer> {
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts", ...(persist ? ["--persist"] : [])],
        cwd: REPO_DIR,
        env: {
            HOST: "127.0.0.1",
            PORT: "0",
            QUEUE_API_TOKEN: TOKEN,
            ...(persistDir ? { PERSIST: persistDir } : {}),
            ...extraEnv,
        },
        stdout: "piped",
        stderr: "piped",
    }).spawn();

    let stdout = "";
    let stderr = "";
    let started: (port: number) => void = () => {};
    let failed: (error: Error) => void = () => {};
    const startedPromise = new Promise<number>((resolve, reject) => {
        started = resolve;
        failed = reject;
    });

    const stdoutTask = (async () => {
        const reader = child.stdout.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                stdout += decoder.decode(value, { stream: true });
                const match = stdout.match(/Listening on (?:http:\/\/)?(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)/);
                if (match) started(Number(match[1]));
            }
        } finally {
            reader.releaseLock();
        }
    })();

    const stderrTask = (async () => {
        const reader = child.stderr.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                stderr += decoder.decode(value, { stream: true });
                if (!stdout.includes("Listening on") && stderr.includes("ConfigError")) {
                    failed(new Error(stderr));
                }
            }
        } finally {
            reader.releaseLock();
        }
    })();

    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`startup timeout; stdout=${stdout}; stderr=${stderr}`)), 5000);
    });

    let port: number;
    try {
        port = await Promise.race([startedPromise, timeout]);
    } catch (error) {
        try {
            child.kill("SIGKILL");
        } catch {
            // The child may already have exited.
        }
        await child.status.catch(() => {});
        await Promise.allSettled([stdoutTask, stderrTask]);
        throw error;
    }

    return { child, persistDir, port, stdout, stderr, stdoutTask, stderrTask };
}

async function stopServer(server: RunningServer, signal: Deno.Signal = "SIGTERM"): Promise<void> {
    try {
        server.child.kill(signal);
    } catch {
        // The child may already have exited.
    }
    await server.child.status.catch(() => {});
    await Promise.allSettled([server.stdoutTask, server.stderrTask]);
}

async function fifoJourney(): Promise<void> {
    const server = await startServer();
    try {
        const auth = authHeaders();
        record("fifo", "health", await request(server, "/health"), "200 JSON health response without auth");
        record("fifo", "health-trailing-slash", await request(server, "/health/"), "200 for documented health variant");
        record("fifo", "queues-empty", await request(server, "/queues", { headers: auth }), "200 and []");

        for (const [name, payload] of [
            ["first", JSON.stringify({ payload: "first" })],
            ["second", JSON.stringify({ payload: { order: 2 } })],
            ["false", JSON.stringify({ payload: false })],
            ["zero", JSON.stringify({ payload: 0 })],
        ]) {
            record("fifo", `enqueue-${name}`, await request(server, "/enqueue/work", postInit(payload)), "200 acknowledgement");
        }
        record("fifo", "length-after-enqueue", await request(server, "/length/work", { headers: auth }), "4");
        record("fifo", "peek-does-not-remove", await request(server, "/peek/work", { headers: auth }), "200 with first payload");
        record("fifo", "length-after-peek", await request(server, "/length/work", { headers: auth }), "still 4");
        for (const expected of ["first", '{"order":2}', "false", "0"]) {
            record("fifo", `dequeue-${expected}`, await request(server, "/dequeue/work", { headers: auth }), `returns ${expected}`);
        }
        record("fifo", "dequeue-empty", await request(server, "/dequeue/work", { headers: auth }), "204 with no body");
        record("fifo", "queues-after-drain", await request(server, "/queues", { headers: auth }), "queue removed after its last item");

        record("fifo", "unauthorized-no-header", await request(server, "/length/protected"), "401 with a Bearer challenge");
        record("fifo", "method-not-allowed", await request(server, "/queues", { method: "POST", headers: auth }), "405 with Allow: GET");

        record("fifo", "unicode-upper-encoding", await request(server, "/enqueue/%C3%BC", postInit('{"payload":"upper"}')), "200");
        record("fifo", "unicode-lower-encoding", await request(server, "/enqueue/%c3%bc", postInit('{"payload":"lower"}')), "200 and same queue");
        record("fifo", "unicode-queue-list", await request(server, "/queues", { headers: auth }), "one canonical queue name");
        record("fifo", "literal-percent-name", await request(server, "/enqueue/%25C3%25BC", postInit('{"payload":"literal-percent"}')), "200 for the literal queue name %C3%BC");
        record("fifo", "literal-percent-length", await request(server, "/length/%25C3%25BC", { headers: auth }), "1 without double-decoding");
        record("fifo", "literal-percent-queue-list", await request(server, "/queues", { headers: auth }), "separate decoded names ü and %C3%BC");

        record("fifo", "head-dequeue-before", await request(server, "/length/head-work", { headers: auth }), "0 before enqueue");
        record("fifo", "head-dequeue-enqueue", await request(server, "/enqueue/head-work", postInit('{"payload":"keep-me"}')), "200");
        record("fifo", "head-dequeue-length-before", await request(server, "/length/head-work", { headers: auth }), "1");
        record("fifo", "head-dequeue", await request(server, "/dequeue/head-work", { method: "HEAD", headers: auth }), "HEAD is bodyless and non-mutating");
        record("fifo", "head-dequeue-length-after", await request(server, "/length/head-work", { headers: auth }), "still 1");
        record("fifo", "head-dequeue-get", await request(server, "/dequeue/head-work", { headers: auth }), "returns keep-me");
    } finally {
        await stopServer(server);
    }
}

function makeExactBody(byteLength: number): string {
    const prefix = '{"payload":"';
    const suffix = '"}';
    return `${prefix}${"x".repeat(byteLength - new TextEncoder().encode(prefix + suffix).byteLength)}${suffix}`;
}

async function validationAndLimitsJourney(): Promise<void> {
    const server = await startServer({ QUEUE_DEPTH_LIMIT: "2", QUEUE_COUNT_LIMIT: "2" });
    try {
        const auth = authHeaders();
        for (const [name, body] of [
            ["invalid-json", "{bad"],
            ["missing-key", '{"data":"x"}'],
            ["null-payload", '{"payload":null}'],
        ]) {
            record("validation-limits", name, await request(server, "/enqueue/invalid", postInit(body)), "400 and no queue mutation");
        }
        record("validation-limits", "invalid-queue-percent-encoding", await request(server, "/enqueue/%ZZ", postInit('{"payload":"bad"}')), "400 and no queue mutation");
        record("validation-limits", "queues-after-invalid-input", await request(server, "/queues", { headers: auth }), "[]");

        const emoji128 = encodeURIComponent("😀".repeat(128));
        record("validation-limits", "unicode-128-name", await request(server, `/enqueue/${emoji128}`, postInit('{"payload":"emoji"}')), "200 for a 128-code-point queue name");
        record("validation-limits", "ascii-129-name", await request(server, `/enqueue/${"a".repeat(129)}`, postInit('{"payload":"too-long"}')), "400 for a 129-character name");

        record("validation-limits", "depth-first", await request(server, "/enqueue/depth", postInit('{"payload":"one"}')), "200");
        record("validation-limits", "depth-second", await request(server, "/enqueue/depth", postInit('{"payload":"two"}')), "200");
        record("validation-limits", "depth-third", await request(server, "/enqueue/depth", postInit('{"payload":"three"}')), "507 and no third item");
        record("validation-limits", "depth-length", await request(server, "/length/depth", { headers: auth }), "2");
        record("validation-limits", "depth-dequeue-one", await request(server, "/dequeue/depth", { headers: auth }), "one");
        record("validation-limits", "depth-retry", await request(server, "/enqueue/depth", postInit('{"payload":"three"}')), "200 after capacity is freed");
        record("validation-limits", "depth-drain-two", await request(server, "/dequeue/depth", { headers: auth }), "two");
        record("validation-limits", "depth-drain-three", await request(server, "/dequeue/depth", { headers: auth }), "three");

        record("validation-limits", "count-a", await request(server, "/enqueue/count-a", postInit('{"payload":"a"}')), "200");
        record("validation-limits", "count-b", await request(server, "/enqueue/count-b", postInit('{"payload":"b"}')), "200");
        record("validation-limits", "count-c-blocked", await request(server, "/enqueue/count-c", postInit('{"payload":"c"}')), "507 at two active queues");
        record("validation-limits", "count-a-drain", await request(server, "/dequeue/count-a", { headers: auth }), "a");
        record("validation-limits", "count-c-retry", await request(server, "/enqueue/count-c", postInit('{"payload":"c"}')), "200 after an active queue is drained");
        record("validation-limits", "count-b-drain", await request(server, "/dequeue/count-b", { headers: auth }), "b");
        record("validation-limits", "count-c-drain", await request(server, "/dequeue/count-c", { headers: auth }), "c");

        record("validation-limits", "body-exactly-1mib", await request(server, "/enqueue/exact-body", postInit(makeExactBody(MAX_BODY_SIZE))), "200 at the byte limit");
        record("validation-limits", "body-over-1mib", await request(server, "/enqueue/over-body", postInit(`${makeExactBody(MAX_BODY_SIZE)}x`)), "413 and no queue mutation");
        record("validation-limits", "over-body-length", await request(server, "/length/over-body", { headers: auth }), "0");
    } finally {
        await stopServer(server);
    }
}

async function rateLimitJourney(): Promise<void> {
    const server = await startServer({ RATE_LIMIT_REQUESTS: "2" });
    try {
        const auth = authHeaders();
        record("rate-limit", "first", await request(server, "/length/rate", { headers: auth }), "200");
        record("rate-limit", "second", await request(server, "/length/rate", { headers: auth }), "200");
        record("rate-limit", "third", await request(server, "/length/rate", { headers: auth }), "429");
        record("rate-limit", "health-exempt", await request(server, "/health"), "200 even when API limit is exhausted");
    } finally {
        await stopServer(server);
    }
}

async function candidateReplayJourney(): Promise<void> {
    for (let run = 1; run <= 3; run++) {
        const server = await startServer();
        try {
            const unauthorized = await request(server, "/length/protected");
            const emoji128Name = encodeURIComponent("😀".repeat(128));
            const bmp128Name = encodeURIComponent("ü".repeat(128));
            const emoji64Name = encodeURIComponent("😀".repeat(64));
            const emoji65Name = encodeURIComponent("😀".repeat(65));
            const emoji128 = await request(server, `/enqueue/${emoji128Name}`, postInit('{"payload":"emoji-128"}'));
            const bmp128 = await request(server, `/enqueue/${bmp128Name}`, postInit('{"payload":"bmp-128"}'));
            const emoji64 = await request(server, `/enqueue/${emoji64Name}`, postInit('{"payload":"emoji-64"}'));
            const emoji65 = await request(server, `/enqueue/${emoji65Name}`, postInit('{"payload":"emoji-65"}'));
            console.log(JSON.stringify({
                journey: "candidate-replay",
                run,
                unauthorized: {
                    status: unauthorized.status,
                    wwwAuthenticate: unauthorized.headers["www-authenticate"] ?? null,
                    body: unauthorized.body,
                },
                queueNameBoundaries: {
                    emoji128CodePoints: 128,
                    emoji128Utf16Units: 256,
                    emoji128Status: emoji128.status,
                    bmp128CodePoints: 128,
                    bmp128Status: bmp128.status,
                    emoji64CodePoints: 64,
                    emoji64Utf16Units: 128,
                    emoji64Status: emoji64.status,
                    emoji65CodePoints: 65,
                    emoji65Utf16Units: 130,
                    emoji65Status: emoji65.status,
                },
            }));
        } finally {
            await stopServer(server);
        }
    }
}

async function persistenceJourney(): Promise<void> {
    const persistDir = await Deno.makeTempDir({ prefix: "queue-exploration-persist-" });
    try {
        const firstServer = await startServer({}, true, persistDir);
        const auth = authHeaders();
        record("persistence", "enqueue-one", await request(firstServer, "/enqueue/persisted", postInit('{"payload":"one"}')), "200");
        record("persistence", "enqueue-two", await request(firstServer, "/enqueue/persisted", postInit('{"payload":"two"}')), "200");
        record("persistence", "dequeue-one-before-restart", await request(firstServer, "/dequeue/persisted", { headers: auth }), "one");
        await stopServer(firstServer);

        const snapshot = await Deno.readTextFile(`${persistDir}/persist.dat`);
        console.log(JSON.stringify({ journey: "persistence", name: "snapshot-after-shutdown", snapshot: compactBody(snapshot), expectation: "remaining item is snapshotted" }));

        const secondServer = await startServer({}, true, persistDir);
        try {
            record("persistence", "length-after-restart", await request(secondServer, "/length/persisted", { headers: auth }), "1");
            record("persistence", "peek-after-restart", await request(secondServer, "/peek/persisted", { headers: auth }), "two");
            record("persistence", "dequeue-after-restart", await request(secondServer, "/dequeue/persisted", { headers: auth }), "two");
            record("persistence", "length-after-drain", await request(secondServer, "/length/persisted", { headers: auth }), "0");
        } finally {
            await stopServer(secondServer);
        }
    } finally {
        await Deno.remove(persistDir, { recursive: true }).catch(() => {});
    }
}

await fifoJourney();
await validationAndLimitsJourney();
await rateLimitJourney();
await candidateReplayJourney();
await persistenceJourney();
