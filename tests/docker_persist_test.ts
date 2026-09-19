import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0";

// Regression test for #114: the README's Docker persistence command must start
// the image as its non-root user and keep items across container recreation.

const ROOT = new URL("..", import.meta.url).pathname;
const IMAGE = "queue-docker-persist-test:latest";
const TOKEN = "docker-persist-test-token";

async function run(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const out = await new Deno.Command(cmd, { args, cwd: ROOT }).output();
    const decode = (b: Uint8Array) => new TextDecoder().decode(b);
    return { code: out.code, stdout: decode(out.stdout), stderr: decode(out.stderr) };
  } catch {
    return { code: -1, stdout: "", stderr: `${cmd} not available` };
  }
}

const dockerAvailable = (await run("docker", ["info"])).code === 0;

const README = await Deno.readTextFile(new URL("../README.md", import.meta.url));

function readmePersistCommand(): string {
  const section = README.match(/## Persistency([\s\S]*?)(\n## |$)/)?.[1] ?? "";
  const block = [...section.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .find((b) => b.includes("docker run")) ?? "";
  assert(block.length > 0, "README Persistency section has no docker run command");
  return block.replace(/\\\n/g, " ").trim();
}

function envValue(command: string, name: string): string {
  return command.match(new RegExp(`-e ${name}=(\\S+)`))?.[1] ?? "";
}

async function waitForServer(port: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/length/probe`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      await res.body?.cancel();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

Deno.test({
  name: "Docker: README persistence command starts and persists across container recreation",
  ignore: !dockerAvailable,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const build = await run("docker", ["build", "-q", "-t", IMAGE, "."]);
    assertEquals(build.code, 0, build.stderr);

    const documented = readmePersistCommand();
    assertStringIncludes(documented, "--persist");
    const persistDir = envValue(documented, "PERSIST").replace(/\/+$/, "");
    assert(persistDir.length > 0, "README persistence command does not set PERSIST");

    const name = `queue-persist-test-${Date.now()}`;
    const volume = `${name}-data`;
    const port = 19000 + Math.floor(Math.random() * 900);

    // Run the documented command as written, swapping only the image tag,
    // the secret token, and the host port, and naming the container.
    const toArgs = (withVolume: boolean) =>
      documented
        .replace(/jonbaldie\/queue(?=\s)/, IMAGE)
        .replace(/QUEUE_API_TOKEN=\S+/, `QUEUE_API_TOKEN=${TOKEN}`)
        .replace(/-p 1991:1991/, `-p ${port}:1991`)
        .replace(
          /^docker run /,
          `docker run --name ${name} ${withVolume ? `-v ${volume}:${persistDir} ` : ""}`,
        )
        .split(/\s+/)
        .slice(1);

    const start = async (withVolume: boolean) => {
      const res = await run("docker", toArgs(withVolume));
      assertEquals(res.code, 0, res.stderr);
      const up = await waitForServer(port);
      const logs = await run("docker", ["logs", name]);
      assert(up, `container did not serve requests:\n${logs.stdout}${logs.stderr}`);
    };
    const remove = () => run("docker", ["rm", "-f", name]);

    try {
      // The verbatim documented command (no volume) must start.
      await start(false);
      await remove();

      // A named volume at the documented path must be writable and durable.
      await start(true);
      const enqueue = await fetch(`http://127.0.0.1:${port}/enqueue/foo`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payload: "survives" }),
      });
      await enqueue.body?.cancel();
      assertEquals(enqueue.status, 200);
      await remove();

      await start(true);
      const dequeue = await fetch(`http://127.0.0.1:${port}/dequeue/foo`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      assertEquals(dequeue.status, 200);
      assertEquals(await dequeue.json(), "survives");
    } finally {
      await remove();
      await run("docker", ["volume", "rm", "-f", volume]);
    }
  },
});
