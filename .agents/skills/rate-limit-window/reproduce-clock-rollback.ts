import QueueManager from "../../../src/manager.ts";
import * as Persistency from "../../../src/persist.ts";
import { createHandler } from "../../../src/handler.ts";

const token = "rate-limit-window-check";
const limit = 3;
const windowMs = 60_000;

async function statusesAt(times: number[]): Promise<number[]> {
    const handler = createHandler(
        new QueueManager(new Persistency.MemoryStore()),
        token,
        limit,
    );
    const requests = times.map(() => new Request("http://localhost/queues", {
        headers: { Authorization: `Bearer ${token}` },
    }));
    const originalNow = Date.now;
    let index = 0;
    Date.now = () => times[Math.min(index++, times.length - 1)];
    try {
        const statuses: number[] = [];
        for (const request of requests) {
            statuses.push((await handler(request)).status);
        }
        return statuses;
    } finally {
        Date.now = originalNow;
    }
}

const monotonicStatuses = await statusesAt([100_000, 100_000, 100_000, 100_000]);
if (monotonicStatuses.join(",") !== "200,200,200,429") {
    throw new Error(`monotonic control failed: ${monotonicStatuses.join(",")}`);
}

const traces = [
    { name: "short model counterexample", times: [90_000, 90_000, 90_000, 160_000] },
    { name: "rollback followed by recovery", times: [100_000, 101_050, 90_000, 160_000, 160_000, 160_000] },
];
const violations: string[] = [];
for (const trace of traces) {
    const statuses = await statusesAt(trace.times);
    const admittedElapsed: number[] = [];
    for (let index = 0; index < statuses.length; index++) {
        const elapsed = (index + 1) * 10_000;
        if (statuses[index] !== 429) admittedElapsed.push(elapsed);
        const active = admittedElapsed.filter((time) => time > elapsed - windowMs).length;
        if (active > limit) {
            violations.push(
                `${trace.name}: admitted ${active} requests within ${windowMs}ms of monotonic elapsed time at request ${index + 1} (wall clock ${trace.times[index]}ms); statuses so far: ${statuses.slice(0, index + 1).join(",")}`,
            );
            break;
        }
    }
}

if (violations.length > 0) {
    throw new Error(violations.join("\n"));
}

console.log("RateLimiter stayed within the configured sliding window.");
