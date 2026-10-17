// Journey 1 variations: concurrent workers, correcting names, HEAD, encoding.
const base = Deno.env.get("BASE") ?? "http://127.0.0.1:18771";
const token = Deno.env.get("TOKEN") ?? "explore-token-2026-10-17";
const out: string[] = [];

function log(line: string): void {
    out.push(line);
    console.log(line);
}

async function call(
    method: string,
    path: string,
    body?: BodyInit,
    headers: Record<string, string> = {},
): Promise<{ status: number; text: string; headers: Record<string, string> }> {
    const response = await fetch(base + path, { method, headers, body });
    const text = await response.text();
    const recorded: Record<string, string> = {};
    response.headers.forEach((value, key) => {
        recorded[key] = value;
    });
    log(`${method} ${path} -> ${statusLine(response.status, text, recorded)}`);
    return { status: response.status, text, headers: recorded };
}

function statusLine(status: number, text: string, headers: Record<string, string>): string {
    return `${status} ${JSON.stringify(text)} headers=${JSON.stringify(headers)}`;
}

function auth(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${token}`, ...extra };
}

const json = { "Content-Type": "application/json" };

// Fresh connection via a second client is just another fetch. Concurrent workers:
const n = 20;
for (let i = 0; i < n; i++) {
    const queued = await call(
        "POST",
        "/enqueue/jobs",
        JSON.stringify({ payload: { n: i, producer: "web" } }),
        auth(json),
    );
    if (queued.status !== 200) {
        log(`enqueue failed at ${i}`);
        break;
    }
}

const taken: string[] = [];
await Promise.all(Array.from({ length: 4 }, async (_, worker) => {
    for (;;) {
        const response = await fetch(base + "/dequeue/jobs", { headers: auth() });
        const text = await response.text();
        if (response.status === 204) {
            log(`worker ${worker} saw empty`);
            return;
        }
        taken.push(`${response.status}:${text}`);
        log(`worker ${worker} ${response.status} ${text}`);
    }
}));
const values = taken.filter((line) => line.startsWith("200:")).map((line) => JSON.parse(line.slice(4)).n);
const unique = new Set(values);
log(`taken=${taken.length} unique=${unique.size} sorted=${JSON.stringify([...values].sort((a, b) => a - b))}`);

// Cancel: peek, then decide not to take it. Item must still be first.
await call("POST", "/enqueue/review", JSON.stringify({ payload: { id: "keep-me" } }), auth(json));
await call("HEAD", "/dequeue/review", undefined, auth());
await call("GET", "/length/review", undefined, auth());
await call("HEAD", "/peek/review", undefined, auth());
await call("GET", "/dequeue/review", undefined, auth());

// A publisher retries a name with a space, then a slash, then unicode.
await call("POST", "/enqueue/user%20signup", JSON.stringify({ payload: "spaced" }), auth(json));
await call("GET", "/queues", undefined, auth());
await call("GET", "/dequeue/user%20signup", undefined, auth());
await call("POST", "/enqueue/" + encodeURIComponent("a/b"), JSON.stringify({ payload: "slashed" }), auth(json));
await call("GET", "/queues", undefined, auth());
await call("GET", "/dequeue/" + encodeURIComponent("a/b"), undefined, auth());
await call("GET", "/dequeue/" + encodeURIComponent("a%2Fb"), undefined, auth());
await call("POST", "/enqueue/" + encodeURIComponent("メール"), JSON.stringify({ payload: "unicode-name" }), auth(json));
await call("GET", "/dequeue/" + encodeURIComponent("メール"), undefined, auth());

// Wrong method, then the right one.
await call("GET", "/enqueue/jobs", undefined, auth());
await call("POST", "/dequeue/jobs", JSON.stringify({ payload: "nope" }), auth(json));

// Missing content-type, body still JSON. Then an explicit correction is unnecessary if this works.
await call("POST", "/enqueue/plain", JSON.stringify({ payload: { ok: true } }), auth());
await call("GET", "/dequeue/plain", undefined, auth());

// Null and an unsafe integer, then a safe retry.
await call("POST", "/enqueue/plain", JSON.stringify({ payload: null }), auth(json));
await call("POST", "/enqueue/plain", JSON.stringify({ payload: 9007199254740993 }), auth(json));
await call("POST", "/enqueue/plain", JSON.stringify({ payload: 9007199254740991 }), auth(json));
await call("GET", "/dequeue/plain", undefined, auth());

const boundary = "n".repeat(128);
const tooLong = "n".repeat(129);
await call("POST", "/enqueue/" + boundary, JSON.stringify({ payload: "edge" }), auth(json));
await call("GET", "/length/" + boundary, undefined, auth());
await call("POST", "/enqueue/" + tooLong, JSON.stringify({ payload: "over" }), auth(json));

await Deno.writeTextFile(new URL("./journey1-variation.txt", import.meta.url), out.join("\n") + "\n");
