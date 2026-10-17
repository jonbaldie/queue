// Journey 1: a publisher and two workers use the HTTP API.
// Run from the repo root after the server is listening.
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
    body?: string,
    headers: Record<string, string> = {},
): Promise<{ status: number; text: string; headers: Record<string, string> }> {
    const response = await fetch(base + path, {
        method,
        headers,
        body,
    });
    const text = await response.text();
    const recorded: Record<string, string> = {};
    response.headers.forEach((value, key) => {
        recorded[key] = value;
    });
    log(`${method} ${path} -> ${response.status} ${JSON.stringify(text)} headers=${JSON.stringify(recorded)}`);
    return { status: response.status, text, headers: recorded };
}

function auth(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${token}`, ...extra };
}

const jobs = [
    { id: "email-1", kind: "email", to: "ada@example.com" },
    { id: "email-2", kind: "email", to: "grace@example.com" },
    { id: "bill-1", kind: "invoice", amount: 0 },
    { id: "bill-2", kind: "invoice", amount: 12.5, paid: false },
];

log(`base=${base}`);
await call("GET", "/health");
await call("GET", "/queues", undefined, auth());
await call("GET", "/length/email", undefined, auth());
await call("GET", "/dequeue/email", undefined, auth());

// Bad publish, then correct it.
await call("POST", "/enqueue/email", "{", auth({ "Content-Type": "application/json" }));
await call(
    "POST",
    "/enqueue/email",
    JSON.stringify({ not_payload: jobs[0] }),
    auth({ "Content-Type": "application/json" }),
);
for (const job of jobs.slice(0, 2)) {
    await call(
        "POST",
        "/enqueue/email",
        JSON.stringify({ payload: job }),
        auth({ "Content-Type": "application/json" }),
    );
}
for (const job of jobs.slice(2)) {
    await call(
        "POST",
        "/enqueue/billing",
        JSON.stringify({ payload: job }),
        auth({ "Content-Type": "application/json" }),
    );
}

// Scalar payloads a worker must not treat as missing.
await call("POST", "/enqueue/flags", JSON.stringify({ payload: false }), auth({ "Content-Type": "application/json" }));
await call("POST", "/enqueue/flags", JSON.stringify({ payload: 0 }), auth({ "Content-Type": "application/json" }));
await call("POST", "/enqueue/flags", JSON.stringify({ payload: "0" }), auth({ "Content-Type": "application/json" }));
await call("POST", "/enqueue/flags", JSON.stringify({ payload: "" }), auth({ "Content-Type": "application/json" }));
await call("POST", "/enqueue/flags", JSON.stringify({ payload: [] }), auth({ "Content-Type": "application/json" }));

await call("GET", "/queues", undefined, auth());
await call("GET", "/length/email", undefined, auth());
await call("GET", "/peek/email", undefined, auth());
await call("GET", "/length/email", undefined, auth());
await call("GET", "/peek/email", undefined, auth());

// Wrong token, then the right one.
await call("GET", "/dequeue/email", undefined, { Authorization: "Bearer wrong-token" });
const first = await call("GET", "/dequeue/email", undefined, auth());
const second = await call("GET", "/dequeue/email", undefined, auth());
await call("GET", "/dequeue/email", undefined, auth());
await call("GET", "/length/email", undefined, auth());
await call("GET", "/queues", undefined, auth());

// Billing worker, including a cancelled peek (look, then leave it).
await call("GET", "/peek/billing", undefined, auth());
await call("GET", "/length/billing", undefined, auth());
await call("GET", "/dequeue/billing", undefined, auth());
await call("GET", "/dequeue/billing", undefined, auth());
await call("GET", "/dequeue/billing", undefined, auth());

// Flags must come back distinct and in order.
const flags: string[] = [];
for (let i = 0; i < 6; i++) {
    const result = await call("GET", "/dequeue/flags", undefined, auth());
    flags.push(`${result.status}:${result.text}`);
}
log(`flags=${JSON.stringify(flags)}`);
log(`first_two=${first.text} then ${second.text}`);

await Deno.writeTextFile(
    new URL("./journey1-transcript.txt", import.meta.url),
    out.join("\n") + "\n",
);
