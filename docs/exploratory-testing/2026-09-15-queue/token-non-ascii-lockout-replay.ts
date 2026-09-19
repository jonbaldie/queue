import { startServer, stopServer, request } from "./driver.ts";

interface TokenCase {
    name: string;
    token: string;
}

const TEST_CASES: TokenCase[] = [
    { name: "Euro currency sign (€, U+20AC, code point > 255)", token: "secret_€" },
    { name: "Unicode emoji (🔑, U+1F511, code point > 255)", token: "token_🔑" },
    { name: "ASCII control escape (\\x1b, code point 27)", token: "token_\x1b" },
];

async function testCurl(port: number, token: string): Promise<number> {
    const cmd = new Deno.Command("curl", {
        args: [
            "-s",
            "-o", "/dev/null",
            "-w", "%{http_code}",
            "-H", `Authorization: Bearer ${token}`,
            `http://127.0.0.1:${port}/queues`
        ],
    });
    const output = await cmd.output();
    const statusCode = parseInt(new TextDecoder().decode(output.stdout).trim(), 10);
    return statusCode;
}

async function testFetch(server: any, token: string): Promise<{ status?: number; error?: string }> {
    try {
        const res = await request(server, "/queues", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        return { status: res.status };
    } catch (err: any) {
        return { error: err.message };
    }
}

async function runReplay(runNum: number): Promise<void> {
    for (const tc of TEST_CASES) {
        const server = await startServer({ QUEUE_API_TOKEN: tc.token });
        try {
            const healthRes = await request(server, "/health");
            const fetchResult = await testFetch(server, tc.token);
            const curlStatus = await testCurl(server.port, tc.token);

            const isLockedOut = (fetchResult.error !== undefined || fetchResult.status !== 200) && curlStatus !== 200;

            console.log(`run=${runNum} token="${tc.token}" case="${tc.name}" port=${server.port} health=${healthRes.status} fetch=${fetchResult.error ? `error(${fetchResult.error})` : fetchResult.status} curl=${curlStatus} all_locked_out=${isLockedOut}`);
        } finally {
            await stopServer(server);
        }
    }
}

async function main() {
    console.log("Testing consecutive clean server instances for non-ASCII / non-ByteString token lockout:");
    for (let run = 1; run <= 3; run++) {
        await runReplay(run);
    }
}

await main();
