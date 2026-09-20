import { startServer, stopServer, request } from "./driver.ts";

async function runReplay(runNum: number, tokenDesc: string, tokenVal: string, headerTokens: string[]): Promise<boolean> {
    const server = await startServer({ QUEUE_API_TOKEN: tokenVal });
    try {
        const healthRes = await request(server, "/health");
        let allLockedOut = true;

        for (const hdrToken of headerTokens) {
            const queuesRes = await request(server, "/queues", {
                headers: { "Authorization": `Bearer ${hdrToken}` }
            });
            const enqueueRes = await request(server, "/enqueue/test", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${hdrToken}`,
                    "Content-Type": "application/json"
                },
                body: '{"payload":"hello"}'
            });

            if (queuesRes.status !== 401 || enqueueRes.status !== 401) {
                allLockedOut = false;
            }
        }

        console.log(`run=${runNum} token="${tokenDesc}" port=${server.port} health=${healthRes.status} all_locked_out=${allLockedOut}`);
        return allLockedOut;
    } finally {
        await stopServer(server);
    }
}

async function main() {
    console.log("Testing consecutive clean server instances for internal whitespace lockout:");
    for (let run = 1; run <= 3; run++) {
        // Test tab
        await runReplay(run, "alpha\\tbeta", "alpha\tbeta", [
            "alpha\tbeta",
            "alpha beta",
            "alpha  beta"
        ]);
        // Test double space
        await runReplay(run, "alpha  beta", "alpha  beta", [
            "alpha  beta",
            "alpha beta",
            "alpha   beta"
        ]);
    }
}

main();
