const REPO_DIR = Deno.cwd();
const TOKEN = "explore-token-20260918";

export type ResponseSummary = {
    status: number;
    body: string;
    headers: Record<string, string>;
};

export type RunningServer = {
    child: Deno.ChildProcess;
    persistDir: string;
    port: number;
    stdout: string;
    stderr: string;
    stdoutTask: Promise<void>;
    stderrTask: Promise<void>;
};

export function compactBody(body: string): string {
    if (body.length <= 240) return body;
    return `${body.slice(0, 240)}… (${body.length} characters)`;
}

export function selectedHeaders(headers: Headers): Record<string, string> {
    const selected: Record<string, string> = {};
    for (const name of ["allow", "content-length", "content-type", "www-authenticate"]) {
        const value = headers.get(name);
        if (value !== null) selected[name] = value;
    }
    return selected;
}

export async function request(
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

export function authHeaders(contentType = false, customToken = TOKEN): Record<string, string> {
    return contentType
        ? { Authorization: `Bearer ${customToken}`, "Content-Type": "application/json" }
        : { Authorization: `Bearer ${customToken}` };
}

export function postInit(body: string, customToken = TOKEN): RequestInit {
    return {
        method: "POST",
        headers: authHeaders(true, customToken),
        body,
    };
}

export function record(journey: string, name: string, result: ResponseSummary, expectation: string): void {
    console.log(JSON.stringify({ journey, name, result, expectation }));
}

export async function startServer(
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

export async function stopServer(server: RunningServer, signal: Deno.Signal = "SIGTERM"): Promise<void> {
    try {
        server.child.kill(signal);
    } catch {
        // The child may already have exited.
    }
    await server.child.status.catch(() => {});
    await Promise.allSettled([server.stdoutTask, server.stderrTask]);
}
