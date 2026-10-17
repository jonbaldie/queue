import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0";

// Regression test for #172: a client that closes its side of the connection
// before sending the declared Content-Length must not be told 413 Payload too
// large. A raw socket is the only way to send a body shorter than its header.

const TOKEN = "aborted-upload-token";
const AUTH = { "Authorization": `Bearer ${TOKEN}` };

async function startServer(): Promise<{ child: Deno.ChildProcess; port: number }> {
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts"],
        env: { HOST: "127.0.0.1", PORT: "0", QUEUE_API_TOKEN: TOKEN },
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
        const match = output.match(/Listening on (?:http:\/\/)?127\.0\.0\.1:(\d+)/);
        if (match) {
            reader.releaseLock();
            return { child, port: parseInt(match[1], 10) };
        }
    }
    reader.releaseLock();
    await stopServer(child);
    throw new Error(`Server did not start. stdout: ${output}`);
}

async function stopServer(child: Deno.ChildProcess): Promise<void> {
    try { await child.stdout.cancel(); } catch { /* ignore */ }
    try { await child.stderr.cancel(); } catch { /* ignore */ }
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    try { await child.status; } catch { /* ignore */ }
}

// Sends the headers and a partial body, half-closes the write side, and
// returns whatever the server answers before closing the connection.
async function sendTruncatedEnqueue(port: number, queue: string, partialBody: string, contentLength: number): Promise<string> {
    const conn = await Deno.connect({ hostname: "127.0.0.1", port });
    try {
        const request = `POST /enqueue/${queue} HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${port}\r\n` +
            `Authorization: Bearer ${TOKEN}\r\n` +
            "Content-Type: application/json\r\n" +
            `Content-Length: ${contentLength}\r\n` +
            "Connection: close\r\n" +
            "\r\n" +
            partialBody;
        await conn.write(new TextEncoder().encode(request));
        await conn.closeWrite();
        return await new Response(conn.readable).text();
    } catch (error) {
        // A connection error is an acceptable answer to an aborted upload.
        return `connection error: ${error}`;
    }
}

Deno.test("e2e: an enqueue whose body is cut short is not reported as 413 (#172)", async () => {
    const { child, port } = await startServer();
    try {
        const response = await sendTruncatedEnqueue(port, "drop", '{"payload":', 40);
        assertEquals(response.includes(" 413 "), false, `aborted upload was reported as too large:\n${response}`);
        if (response.startsWith("HTTP/")) {
            assertStringIncludes(response.split("\r\n")[0], " 400 ");
        }

        const lengthRes = await fetch(`http://127.0.0.1:${port}/length/drop`, { headers: AUTH });
        assertEquals(await lengthRes.text(), "0");

        const retry = await fetch(`http://127.0.0.1:${port}/enqueue/drop`, {
            method: "POST",
            headers: { ...AUTH, "Content-Type": "application/json" },
            body: JSON.stringify({ payload: "retry-ok" }),
        });
        await retry.text();
        assertEquals(retry.status, 200);
    } finally {
        await stopServer(child);
    }
});
