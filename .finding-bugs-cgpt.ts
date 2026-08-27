/**
 * Coverage-guided property campaign against the queue HTTP + persist entry points.
 * Not part of the test suite. Untracked scratch.
 */
import QueueManager from "./src/manager.ts";
import { createHandler } from "./src/handler.ts";
import { FileStore, MemoryStore } from "./src/persist.ts";
import { parseConfig, ConfigError } from "./src/config.ts";

type Json =
    | string
    | number
    | boolean
    | Json[]
    | { [key: string]: Json };

type Action =
    | { kind: "enqueue"; queue: string; payload: Json }
    | { kind: "dequeue"; queue: string }
    | { kind: "peek"; queue: string }
    | { kind: "length"; queue: string }
    | { kind: "queues" }
    | { kind: "health" }
    | { kind: "badAuth" }
    | { kind: "primitiveBody"; body: string }
    | { kind: "missingPayload" }
    | { kind: "nullPayload" }
    | { kind: "invalidJson" }
    | { kind: "wrongMethod" }
    | { kind: "longName" }
    | { kind: "oversizeHeader" }
    | { kind: "spoofedRateLimit"; ip: string };

interface Seed {
    depthLimit: number;
    countLimit: number;
    rateLimit: number;
    actions: Action[];
}

interface Finding {
    property: string;
    seed: Seed;
    detail: unknown;
}

class Random {
    constructor(private state: number) {}

    public next(): number {
        this.state += 0x6D2B79F5;
        let value = this.state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
    }

    public integer(maxExclusive: number): number {
        if (maxExclusive <= 0) return 0;
        return Math.floor(this.next() * maxExclusive);
    }

    public pick<T>(items: T[]): T {
        return items[this.integer(items.length)];
    }
}

function argument(name: string, fallback: number): number {
    const value = Deno.args.find((item) => item.startsWith(`--${name}=`));
    return value === undefined ? fallback : Number(value.slice(name.length + 3));
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function encoded(value: Json): string {
    return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function coverageKey(parts: unknown[]): string {
    return parts.map((part) => JSON.stringify(part)).join("|");
}

function generatePayload(random: Random): Json {
    switch (random.integer(8)) {
        case 0: return random.integer(1000);
        case 1: return 0;
        case 2: return random.integer(2) === 0;
        case 3: return false;
        case 4: return `v-${random.integer(50)}`;
        case 5: return "";
        case 6: return [random.integer(10), `n-${random.integer(10)}`];
        default: return { id: random.integer(20), ok: random.integer(2) === 0 };
    }
}

function generateQueue(random: Random, countLimit: number): string {
    const names = ["a", "b", "c", "d", "e", "q0", "q1", "q2"];
    if (random.integer(8) === 0) return `q${random.integer(countLimit + 3)}`;
    return random.pick(names);
}

function generateAction(random: Random, countLimit: number): Action {
    const queue = generateQueue(random, countLimit);
    const roll = random.integer(100);
    if (roll < 28) return { kind: "enqueue", queue, payload: generatePayload(random) };
    if (roll < 42) return { kind: "dequeue", queue };
    if (roll < 52) return { kind: "peek", queue };
    if (roll < 62) return { kind: "length", queue };
    if (roll < 70) return { kind: "queues" };
    if (roll < 75) return { kind: "health" };
    if (roll < 80) return { kind: "badAuth" };
    if (roll < 84) return { kind: "primitiveBody", body: random.pick(["0", "true", "false", "null", '"x"', "[]"]) };
    if (roll < 87) return { kind: "missingPayload" };
    if (roll < 89) return { kind: "nullPayload" };
    if (roll < 91) return { kind: "invalidJson" };
    if (roll < 93) return { kind: "wrongMethod" };
    if (roll < 95) return { kind: "longName" };
    if (roll < 97) return { kind: "oversizeHeader" };
    return { kind: "spoofedRateLimit", ip: `10.0.0.${random.integer(20)}` };
}

function generateSeed(random: Random): Seed {
    const depthLimit = 1 + random.integer(4);
    const countLimit = 1 + random.integer(4);
    const rateLimit = 1_000_000;
    const length = 1 + random.integer(12);
    const actions: Action[] = [];
    for (let i = 0; i < length; i++) actions.push(generateAction(random, countLimit));
    return { depthLimit, countLimit, rateLimit, actions };
}

function mutatePayload(random: Random, payload: Json): Json {
    if (typeof payload !== "object" || payload === null) return generatePayload(random);
    if (Array.isArray(payload)) {
        if (payload.length === 0 || random.integer(3) === 0) return [...payload, generatePayload(random)];
        const next = [...payload];
        next[random.integer(next.length)] = generatePayload(random);
        return next;
    }
    const keys = Object.keys(payload);
    if (keys.length === 0 || random.integer(3) === 0) {
        return { ...payload, extra: generatePayload(random) };
    }
    const key = random.pick(keys);
    return { ...payload, [key]: generatePayload(random) };
}

function mutateAction(random: Random, action: Action, countLimit: number): Action {
    if (action.kind === "enqueue") {
        const roll = random.integer(3);
        if (roll === 0) return { ...action, queue: generateQueue(random, countLimit) };
        if (roll === 1) return { ...action, payload: mutatePayload(random, action.payload) };
        return generateAction(random, countLimit);
    }
    if ("queue" in action && random.integer(2) === 0) {
        return { ...action, queue: generateQueue(random, countLimit) } as Action;
    }
    return generateAction(random, countLimit);
}

function mutateSeed(random: Random, seed: Seed): Seed {
    const next = clone(seed);
    const roll = random.integer(8);
    if (roll === 0) next.depthLimit = 1 + random.integer(5);
    if (roll === 1) next.countLimit = 1 + random.integer(5);
    if (roll === 2) next.rateLimit = 1 + random.integer(15);
    if (next.actions.length === 0 || roll === 3) {
        next.actions.push(generateAction(random, next.countLimit));
        return next;
    }
    const index = random.integer(next.actions.length);
    if (roll === 4 && next.actions.length > 1) {
        next.actions.splice(index, 1);
        return next;
    }
    if (roll === 5) {
        next.actions.splice(index, 0, generateAction(random, next.countLimit));
        return next;
    }
    if (roll === 6 && next.actions.length > 1) {
        const other = random.integer(next.actions.length);
        const tmp = next.actions[index];
        next.actions[index] = next.actions[other];
        next.actions[other] = tmp;
        return next;
    }
    next.actions[index] = mutateAction(random, next.actions[index], next.countLimit);
    return next;
}

function shrinkSeed(seed: Seed, stillFails: (candidate: Seed) => Promise<Finding | undefined>): Promise<Seed> {
    return (async () => {
        let current = clone(seed);
        let reduced = true;
        while (reduced) {
            reduced = false;
            for (let i = 0; i < current.actions.length; i++) {
                const candidate = clone(current);
                candidate.actions.splice(i, 1);
                if (candidate.actions.length === 0) continue;
                if (await stillFails(candidate)) {
                    current = candidate;
                    reduced = true;
                    break;
                }
            }
        }
        return current;
    })();
}

interface RunResult {
    coverage: Set<string>;
    findings: Finding[];
    discards: number;
    successes: number;
}

const TOKEN = "campaign-token";
const AUTH = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function runSeed(seed: Seed): Promise<RunResult> {
    const coverage = new Set<string>();
    const findings: Finding[] = [];
    let discards = 0;
    let successes = 0;
    const manager = new QueueManager<string>(new MemoryStore<string>(), seed.depthLimit, seed.countLimit);
    const handler = createHandler(manager, TOKEN, seed.rateLimit);
    const model = new Map<string, Json[]>();
    const createdByRead = new Set<string>();

    const send = (path: string, init: RequestInit = {}, info?: Deno.ServeHandlerInfo) =>
        handler(new Request("http://127.0.0.1" + path, init), info);

    const note = (property: string, detail: unknown) => {
        if (!findings.some((finding) => finding.property === property)) {
            findings.push({ property, seed: clone(seed), detail });
        }
    };

    for (const action of seed.actions) {
        try {
            if (action.kind === "enqueue") {
                const queueItems = model.get(action.queue) ?? [];
                const existed = model.has(action.queue) || manager.listQueues().includes(action.queue);
                const shouldAccept = queueItems.length < seed.depthLimit &&
                    (existed || manager.listQueues().length < seed.countLimit || model.has(action.queue));
                const response = await send(`/enqueue/${action.queue}`, {
                    method: "POST",
                    headers: AUTH,
                    body: JSON.stringify({ payload: action.payload }),
                });
                const body = await response.text();
                coverage.add(coverageKey(["enqueue", response.status, typeof action.payload, existed, shouldAccept]));
                if (response.status === 429) {
                    discards++;
                    continue;
                }
                if (action.queue.length > 128) {
                    if (response.status !== 400) note("long-name-is-400", { action, status: response.status, body });
                    continue;
                }
                if (shouldAccept && response.status !== 200) {
                    note("accepted-enqueue-is-200", { action, expected: 200, status: response.status, body });
                }
                if (!shouldAccept && response.status !== 507 && response.status !== 200) {
                    note("rejected-enqueue-is-507", { action, status: response.status, body });
                }
                if (response.status === 200) {
                    if (!model.has(action.queue)) model.set(action.queue, queueItems);
                    queueItems.push(action.payload);
                    createdByRead.delete(action.queue);
                    successes++;
                }
                continue;
            }

            if (action.kind === "dequeue") {
                const queueItems = model.get(action.queue);
                const response = await send(`/dequeue/${action.queue}`, { headers: AUTH });
                const body = await response.text();
                coverage.add(coverageKey(["dequeue", response.status, Boolean(queueItems && queueItems.length)]));
                if (response.status === 429) {
                    discards++;
                    continue;
                }
                if (queueItems && queueItems.length > 0) {
                    const expected = encoded(queueItems[0]);
                    if (response.status !== 200 || body !== expected) {
                        note("fifo-dequeue", { action, expected, status: response.status, body });
                    }
                    queueItems.shift();
                    if (queueItems.length === 0) model.delete(action.queue);
                    successes++;
                } else if (response.status !== 204 && response.status !== 200) {
                    note("empty-dequeue-status", { action, status: response.status, body });
                } else {
                    discards++;
                }
                continue;
            }

            if (action.kind === "peek") {
                const queueItems = model.get(action.queue);
                const before = manager.listQueues().slice();
                const response = await send(`/peek/${action.queue}`, { headers: AUTH });
                const body = await response.text();
                const after = manager.listQueues();
                coverage.add(coverageKey(["peek", response.status, Boolean(queueItems && queueItems.length)]));
                if (response.status === 429) {
                    discards++;
                    continue;
                }
                if (JSON.stringify(before) !== JSON.stringify(after)) {
                    note("peek-does-not-create-queues", { action, before, after });
                }
                if (queueItems && queueItems.length > 0) {
                    const expected = encoded(queueItems[0]);
                    if (response.status !== 200 || body !== expected) {
                        note("peek-matches-head", { action, expected, status: response.status, body });
                    }
                    successes++;
                } else if (response.status !== 204) {
                    note("empty-peek-is-204", { action, status: response.status, body });
                } else {
                    discards++;
                }
                continue;
            }

            if (action.kind === "length") {
                const beforeCreateBudget = seed.countLimit - manager.listQueues().length;
                const existed = manager.listQueues().includes(action.queue);
                const response = await send(`/length/${action.queue}`, { headers: AUTH });
                const body = await response.text();
                coverage.add(coverageKey(["length", response.status, existed, beforeCreateBudget]));
                if (response.status === 429) {
                    discards++;
                    continue;
                }
                if (response.status !== 200) {
                    note("length-is-200", { action, status: response.status, body });
                    continue;
                }
                const expected = String((model.get(action.queue) ?? []).length);
                if (existed && body !== expected && model.has(action.queue)) {
                    note("length-matches-pending", { action, expected, body });
                }
                if (!existed && !model.has(action.queue) && manager.listQueues().includes(action.queue)) {
                    createdByRead.add(action.queue);
                    note("reads-do-not-create-empty-queues", {
                        action,
                        queues: manager.listQueues(),
                    });
                }
                successes++;
                continue;
            }

            if (action.kind === "queues") {
                const response = await send("/queues", { headers: AUTH });
                const listed = await response.json() as string[];
                coverage.add(coverageKey(["queues", response.status, listed.length]));
                if (response.status === 429) {
                    discards++;
                    continue;
                }
                if (listed.length > seed.countLimit) {
                    note("queue-count-never-exceeds-limit", { listed, limit: seed.countLimit });
                }
                const emptyListed = listed.filter((name) => (model.get(name) ?? []).length === 0 && createdByRead.has(name));
                if (emptyListed.length > 0) {
                    note("listed-queues-are-nonempty", { emptyListed, listed });
                }
                successes++;
                continue;
            }

            if (action.kind === "health") {
                const response = await send("/health");
                coverage.add(coverageKey(["health", response.status]));
                if (response.status !== 200) note("health-is-public-200", { status: response.status });
                else successes++;
                continue;
            }

            if (action.kind === "badAuth") {
                const response = await send("/queues", { headers: { Authorization: "Bearer wrong" } });
                coverage.add(coverageKey(["badAuth", response.status]));
                if (response.status !== 401) note("wrong-token-is-401", { status: response.status });
                else successes++;
                continue;
            }

            if (action.kind === "primitiveBody") {
                const response = await send("/enqueue/p", {
                    method: "POST",
                    headers: AUTH,
                    body: action.body,
                });
                coverage.add(coverageKey(["primitiveBody", action.body, response.status]));
                if (response.status !== 400) note("primitive-json-is-400", { body: action.body, status: response.status });
                else successes++;
                continue;
            }

            if (action.kind === "missingPayload") {
                const response = await send("/enqueue/p", {
                    method: "POST",
                    headers: AUTH,
                    body: JSON.stringify({ other: 1 }),
                });
                coverage.add(coverageKey(["missingPayload", response.status]));
                if (response.status !== 400) note("missing-payload-is-400", { status: response.status });
                else successes++;
                continue;
            }

            if (action.kind === "nullPayload") {
                const response = await send("/enqueue/p", {
                    method: "POST",
                    headers: AUTH,
                    body: JSON.stringify({ payload: null }),
                });
                coverage.add(coverageKey(["nullPayload", response.status]));
                if (response.status !== 400) note("null-payload-is-400", { status: response.status });
                else successes++;
                continue;
            }

            if (action.kind === "invalidJson") {
                const response = await send("/enqueue/p", {
                    method: "POST",
                    headers: AUTH,
                    body: "{",
                });
                coverage.add(coverageKey(["invalidJson", response.status]));
                if (response.status !== 400) note("invalid-json-is-400", { status: response.status });
                else successes++;
                continue;
            }

            if (action.kind === "wrongMethod") {
                const response = await send("/enqueue/p", { headers: AUTH });
                coverage.add(coverageKey(["wrongMethod", response.status]));
                if (response.status !== 405) note("wrong-method-is-405", { status: response.status });
                else successes++;
                continue;
            }

            if (action.kind === "longName") {
                const response = await send(`/enqueue/${"x".repeat(129)}`, {
                    method: "POST",
                    headers: AUTH,
                    body: JSON.stringify({ payload: "x" }),
                });
                coverage.add(coverageKey(["longName", response.status]));
                if (response.status !== 400) note("long-name-is-400", { status: response.status });
                else successes++;
                continue;
            }

            if (action.kind === "oversizeHeader") {
                const response = await send("/enqueue/p", {
                    method: "POST",
                    headers: { ...AUTH, "content-length": String(1024 * 1024 + 1) },
                    body: JSON.stringify({ payload: "x" }),
                });
                coverage.add(coverageKey(["oversizeHeader", response.status]));
                if (response.status !== 413) note("oversize-is-413", { status: response.status });
                else successes++;
                continue;
            }

            if (action.kind === "spoofedRateLimit") {
                const info = {
                    remoteAddr: { transport: "tcp", hostname: "203.0.113.10", port: 1234 } as Deno.NetAddr,
                    completed: Promise.resolve(),
                } satisfies Deno.ServeHandlerInfo;
                const response = await send("/queues", {
                    headers: { ...AUTH, "x-forwarded-for": action.ip },
                }, info);
                coverage.add(coverageKey(["spoofedRateLimit", response.status, action.ip]));
                if (response.status === 429) discards++;
                else successes++;
            }
        } catch (error) {
            note("every-request-returns-a-response", { action, error: String(error) });
        }
    }

    const remainingBudget = seed.countLimit - manager.listQueues().length;
    if (createdByRead.size > 0 && remainingBudget === 0) {
        const probeName = "fresh-enqueue-target";
        if (!manager.listQueues().includes(probeName)) {
            const response = await send(`/enqueue/${probeName}`, {
                method: "POST",
                headers: AUTH,
                body: JSON.stringify({ payload: "need-a-slot" }),
            });
            coverage.add(coverageKey(["read-consumed-slot", response.status, remainingBudget]));
            if (response.status === 507) {
                note("reads-do-not-consume-queue-slots", {
                    createdByRead: [...createdByRead],
                    queues: manager.listQueues(),
                    status: response.status,
                });
            }
        }
    }

    return { coverage, findings, discards, successes };
}

async function runPersistProperties(random: Random): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Persist load must not exceed queue count.
    {
        const directory = await Deno.makeTempDir({ prefix: "queue-cgpt-count-" });
        try {
            const store = new FileStore<string>();
            store.dir(directory);
            store.clear();
            store.saveEvent("one", "a", true);
            store.saveEvent("two", "b", true);
            const manager = new QueueManager<string>(store, 10, 1);
            try {
                manager.load();
                if (manager.listQueues().length > 1) {
                    findings.push({
                        property: "persist-load-respects-count-limit",
                        seed: { depthLimit: 10, countLimit: 1, rateLimit: 100, actions: [] },
                        detail: { queues: manager.listQueues() },
                    });
                }
            } catch (error) {
                findings.push({
                    property: "persist-load-respects-count-limit",
                    seed: { depthLimit: 10, countLimit: 1, rateLimit: 100, actions: [] },
                    detail: { threw: String(error) },
                });
            }
        } finally {
            await Deno.remove(directory, { recursive: true }).catch(() => undefined);
        }
    }

    // Persist load must not throw when the log is deeper than the current depth limit.
    {
        const directory = await Deno.makeTempDir({ prefix: "queue-cgpt-depth-" });
        try {
            const store = new FileStore<string>();
            store.dir(directory);
            store.clear();
            store.saveEvent("jobs", "a", true);
            store.saveEvent("jobs", "b", true);
            const manager = new QueueManager<string>(store, 1, 10);
            try {
                manager.load();
                if (manager.length("jobs") > 1) {
                    findings.push({
                        property: "persist-load-respects-depth-limit",
                        seed: { depthLimit: 1, countLimit: 10, rateLimit: 100, actions: [] },
                        detail: { length: manager.length("jobs") },
                    });
                }
            } catch (error) {
                findings.push({
                    property: "persist-load-respects-depth-limit",
                    seed: { depthLimit: 1, countLimit: 10, rateLimit: 100, actions: [] },
                    detail: { threw: String(error) },
                });
            }
        } finally {
            await Deno.remove(directory, { recursive: true }).catch(() => undefined);
        }
    }

    // Missing persist directory should not 500 on enqueue.
    {
        const directory = await Deno.makeTempDir({ prefix: "queue-cgpt-missing-" });
        const missing = directory + "/nope";
        try {
            const store = new FileStore<string>();
            store.dir(missing);
            const manager = new QueueManager<string>(store, 10, 10);
            const handler = createHandler(manager, TOKEN, 1000);
            try {
                const response = await handler(new Request("http://127.0.0.1/enqueue/q", {
                    method: "POST",
                    headers: AUTH,
                    body: JSON.stringify({ payload: "x" }),
                }));
                if (response.status === 500 || response.status === 200) {
                    // 200 would mean it created the dir or wrote anyway; 500 is the bug.
                }
                if (response.status >= 500) {
                    findings.push({
                        property: "missing-persist-dir-is-not-500",
                        seed: { depthLimit: 10, countLimit: 10, rateLimit: 1000, actions: [] },
                        detail: { status: response.status, body: await response.text() },
                    });
                }
            } catch (error) {
                findings.push({
                    property: "missing-persist-dir-is-not-500",
                    seed: { depthLimit: 10, countLimit: 10, rateLimit: 1000, actions: [] },
                    detail: { threw: String(error) },
                });
            }
        } finally {
            await Deno.remove(directory, { recursive: true }).catch(() => undefined);
        }
    }

    // Rate limit must not be bypassed by X-Forwarded-For.
    {
        const manager = new QueueManager<string>(new MemoryStore<string>(), 10, 10);
        const handler = createHandler(manager, TOKEN, 2);
        const info = {
            remoteAddr: { transport: "tcp", hostname: "198.51.100.9", port: 9 } as Deno.NetAddr,
            completed: Promise.resolve(),
        } satisfies Deno.ServeHandlerInfo;
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) {
            const response = await handler(new Request("http://127.0.0.1/queues", {
                headers: { ...AUTH, "x-forwarded-for": `203.0.113.${i}` },
            }), info);
            statuses.push(response.status);
            await response.text();
        }
        if (statuses.every((status) => status === 200)) {
            findings.push({
                property: "x-forwarded-for-cannot-bypass-rate-limit",
                seed: { depthLimit: 10, countLimit: 10, rateLimit: 2, actions: [] },
                detail: { statuses },
            });
        }
        void random;
    }

    // parseConfig still rejects junk.
    try {
        parseConfig({ QUEUE_COUNT_LIMIT: "1x" }, []);
        findings.push({
            property: "integer-env-rejects-trailing-junk",
            seed: { depthLimit: 1, countLimit: 1, rateLimit: 1, actions: [] },
            detail: { accepted: "1x" },
        });
    } catch (error) {
        if (!(error instanceof ConfigError)) {
            findings.push({
                property: "integer-env-rejects-trailing-junk",
                seed: { depthLimit: 1, countLimit: 1, rateLimit: 1, actions: [] },
                detail: { threw: String(error) },
            });
        }
    }

    return findings;
}

const budget = argument("budget", 400);
const random = new Random(argument("seed", 7));
const successCorpus: Array<{ seed: Seed; coverage: number; energy: number }> = [];
const discardCorpus: Array<{ seed: Seed; coverage: number; energy: number }> = [];
const seenCoverage = new Set<string>();
const findingsByProperty = new Map<string, Finding>();

function remember(finding: Finding): void {
    if (!findingsByProperty.has(finding.property)) findingsByProperty.set(finding.property, finding);
}

for (const finding of await runPersistProperties(random)) remember(finding);

let iterations = 0;
let randomMode = true;
while (iterations < budget) {
    iterations++;
    let seed: Seed;
    if (randomMode || successCorpus.length === 0) {
        seed = generateSeed(random);
    } else {
        const pool = successCorpus.length > 0 && random.integer(4) !== 0
            ? successCorpus
            : (discardCorpus.length > 0 ? discardCorpus : successCorpus);
        const chosen = pool[random.integer(pool.length)];
        if (chosen.energy <= 0) {
            randomMode = true;
            seed = generateSeed(random);
        } else {
            chosen.energy -= 1;
            seed = mutateSeed(random, chosen.seed);
        }
    }

    const result = await runSeed(seed);
    let novel = 0;
    for (const key of result.coverage) {
        if (!seenCoverage.has(key)) {
            seenCoverage.add(key);
            novel++;
        }
    }
    for (const finding of result.findings) remember(finding);

    const energy = Math.max(1, 8 - seed.actions.length) + novel * 4;
    const entry = { seed, coverage: result.coverage.size, energy };
    if (result.successes > 0 && novel > 0) {
        successCorpus.push(entry);
        randomMode = false;
    } else if (result.discards > 0 && novel > 0) {
        discardCorpus.push(entry);
        if (successCorpus.length === 0) randomMode = false;
    } else if (novel === 0 && successCorpus.every((item) => item.energy <= 0)) {
        randomMode = true;
    }
    if (successCorpus.length > 80) successCorpus.splice(0, successCorpus.length - 80);
    if (discardCorpus.length > 40) discardCorpus.splice(0, discardCorpus.length - 40);
}

const shrunk: Record<string, unknown> = {};
for (const [property, finding] of findingsByProperty) {
    if (finding.seed.actions.length === 0) {
        shrunk[property] = { detail: finding.detail, actions: [] };
        continue;
    }
    const minimised = await shrinkSeed(finding.seed, async (candidate) => {
        const result = await runSeed(candidate);
        return result.findings.find((item) => item.property === property);
    });
    const confirmed = await runSeed(minimised);
    const still = confirmed.findings.find((item) => item.property === property);
    shrunk[property] = {
        actions: minimised.actions,
        depthLimit: minimised.depthLimit,
        countLimit: minimised.countLimit,
        rateLimit: minimised.rateLimit,
        detail: still?.detail ?? finding.detail,
    };
}

console.error(JSON.stringify({
    iterations,
    coverageKeys: seenCoverage.size,
    successCorpus: successCorpus.length,
    discardCorpus: discardCorpus.length,
    properties: [...findingsByProperty.keys()],
    shrunk,
}, null, 2));
