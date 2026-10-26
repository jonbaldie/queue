// Exercise real binaries: the shipped build goes through the same CLI as Docker
// and CI. Per-dimension probes widen only env access, never copy the flag list.
import { assertEquals } from "jsr:@std/assert@1.0";
import { compileBinary } from "../scripts/compile.ts";

async function compile(output: string): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--frozen", "--allow-run", "scripts/compile.ts", output],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
}

async function withServer(
  binary: string,
  env: Record<string, string>,
  args: string[],
  check: (url: string) => Promise<void>,
): Promise<void> {
  const child = new Deno.Command(binary, {
    args,
    env: {
      QUEUE_API_TOKEN: "compile-test-token",
      HOST: "127.0.0.1",
      PORT: "0",
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let output = "";
  let announce!: (address: { url: string; hostname: string }) => void;
  const listening = new Promise<{ url: string; hostname: string }>((resolve) =>
    announce = resolve
  );
  const read = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      output += new TextDecoder().decode(chunk);
      const match = output.match(/Listening on ([^\s]+):(\d+)/);
      if (match) {
        announce({ url: `http://127.0.0.1:${match[2]}`, hostname: match[1] });
      }
    }
  };
  const readers = Promise.all([read(child.stdout), read(child.stderr)]);
  let timer: number | undefined;
  try {
    const address = await Promise.race([
      listening,
      child.status.then(() => {
        throw new Error(`Binary exited: ${output}`);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Startup timed out: ${output}`)),
          10000,
        );
      }),
    ]);
    assertEquals(address.hostname, env.HOST ?? "127.0.0.1");
    await check(address.url);
  } finally {
    clearTimeout(timer);
    try {
      child.kill("SIGTERM");
    } catch { /* already exited */ }
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch { /* already exited */ }
    }, 5000);
    const status = await child.status;
    clearTimeout(killTimer);
    await readers;
    assertEquals(status.code, 0, output);
  }
}

const headers = {
  Authorization: "Bearer compile-test-token",
  "Content-Type": "application/json",
};

async function checkPersistence(
  binary: string,
  persistDir: string,
): Promise<void> {
  const env = { HOST: "0.0.0.0", PERSIST: persistDir };
  await withServer(binary, env, ["--persist"], async (url) => {
    const response = await fetch(`${url}/enqueue/compiled`, {
      method: "POST",
      headers,
      body: JSON.stringify({ payload: { evidence: "survives-restart" } }),
    });
    assertEquals(response.status, 200, await response.text());
  });
  await withServer(binary, env, ["--persist"], async (url) => {
    const response = await fetch(`${url}/dequeue/compiled`, { headers });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { evidence: "survives-restart" });
  });
}

Deno.test("compiled binary: shipped permissions support runtime config and persistence (#64)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "queue-compile-test-" });
  try {
    await compile(`${dir}/queue`);
    await checkPersistence(`${dir}/queue`, `${dir}/non-default-persist`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("compiled binary: arbitrary persistence directory with unrestricted env (#65)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "queue-compile-test-" });
  try {
    await compileBinary(`${dir}/queue`, { env: true });
    await checkPersistence(`${dir}/queue`, `${dir}/custom-persist`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("compiled binary: runtime HOST/PORT with unrestricted env (#68)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "queue-compile-test-" });
  // Reserve an available non-default port without depending on a fixed free port.
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = listener.addr.port;
  listener.close();
  try {
    await compileBinary(`${dir}/queue`, { env: true });
    await withServer(
      `${dir}/queue`,
      { HOST: "0.0.0.0", PORT: String(port) },
      [],
      async (url) => {
        assertEquals(new URL(url).port, String(port));
        const response = await fetch(`${url}/health`);
        assertEquals(response.status, 200);
        await response.body?.cancel();
      },
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
