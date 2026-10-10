// Journey 1: producers and polling workers against the compiled binary.
// Usage: deno run -A journey1_workers.ts <binary> <port> [RATE_LIMIT_REQUESTS]
const [bin, portArg, rate] = Deno.args;
const port = Number(portArg);
const token = "qx-token-20261010";
const base = `http://127.0.0.1:${port}`;
const auth = { Authorization: `Bearer ${token}` };

const env: Record<string, string> = { QUEUE_API_TOKEN: token, PORT: String(port) };
if (rate) env.RATE_LIMIT_REQUESTS = rate;
const child = new Deno.Command(bin, { env, stdout: "null", stderr: "piped" }).spawn();

async function waitReady() {
    for (let i = 0; i < 100; i++) {
        try {
            const r = await fetch(`${base}/health`);
            await r.body?.cancel();
            if (r.ok) return;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server not ready");
}

const statuses: Record<number, number> = {};
const count = (s: number) => statuses[s] = (statuses[s] ?? 0) + 1;

async function produce(id: number, n: number) {
    for (let i = 0; i < n; i++) {
        const r = await fetch(`${base}/enqueue/jobs`, {
            method: "POST",
            headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({ payload: { producer: id, seq: i } }),
        });
        count(r.status);
        await r.body?.cancel();
    }
}

const received: { producer: number; seq: number }[] = [];
async function consume(stopAfterEmpty: number) {
    let empties = 0;
    while (empties < stopAfterEmpty) {
        const r = await fetch(`${base}/dequeue/jobs`, { headers: auth });
        count(r.status);
        if (r.status === 200) {
            received.push(await r.json());
            empties = 0;
        } else {
            await r.body?.cancel();
            empties++;
            await new Promise((res) => setTimeout(res, 20));
        }
    }
}

try {
    await waitReady();
    const PRODUCERS = 3, PER = 40;
    await Promise.all([
        ...Array.from({ length: PRODUCERS }, (_, i) => produce(i, PER)),
        consume(10), consume(10), consume(10),
    ]);
    // Final drain in case consumers stopped early.
    await consume(3);
    const len = await (await fetch(`${base}/length/jobs`, { headers: auth })).text();
    const keys = received.map((m) => `${m.producer}:${m.seq}`);
    const unique = new Set(keys);
    let perProducerOrdered = true;
    for (let p = 0; p < PRODUCERS; p++) {
        const seqs = received.filter((m) => m.producer === p).map((m) => m.seq);
        if (seqs.some((s, i) => i > 0 && s < seqs[i - 1])) perProducerOrdered = false;
    }
    console.log(JSON.stringify({
        rateLimit: rate ?? "default",
        statuses,
        sent: PRODUCERS * PER,
        received: received.length,
        unique: unique.size,
        duplicates: received.length - unique.size,
        perProducerOrdered,
        finalLength: len,
    }));
} finally {
    child.kill("SIGTERM");
    await child.status;
}
