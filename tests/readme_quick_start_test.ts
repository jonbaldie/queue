import { assert, assertStringIncludes } from "jsr:@std/assert@1.0";

const README = await Deno.readTextFile(
  new URL("../README.md", import.meta.url),
);

function codeBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) =>
    match[1]
  );
}

Deno.test("README quick start documents authenticated, reachable commands", () => {
  const installSection =
    README.match(/## How to install([\s\S]*?)## Usage/)?.[1] ?? "";
  const installBlocks = codeBlocks(installSection);
  const executableCommand =
    installBlocks.find((block) =>
      /\bqueue\b/.test(block) && !block.includes("docker")
    ) ?? "";
  const dockerCommand =
    installBlocks.find((block) => block.includes("docker run")) ?? "";
  const dockerCommands = codeBlocks(README).filter((block) =>
    block.includes("docker run")
  );

  assertStringIncludes(executableCommand, "QUEUE_API_TOKEN=");
  assertStringIncludes(dockerCommand, "QUEUE_API_TOKEN=");
  assert(dockerCommands.length > 0, "README is missing a Docker start command");
  for (const command of dockerCommands) {
    assertStringIncludes(command, "QUEUE_API_TOKEN=");
    assertStringIncludes(command, "HOST=0.0.0.0");
    assertStringIncludes(command, "-p 1991:1991");
  }

  const curlCommands = codeBlocks(README)
    .flatMap((block) => block.split("\n"))
    .filter((line) => line.trimStart().startsWith("curl "));

  for (const endpoint of ["/enqueue/foo", "/dequeue/foo", "/length/foo"]) {
    const command = curlCommands.find((line) => line.includes(endpoint)) ?? "";
    assert(
      command.length > 0,
      `README is missing a curl example for ${endpoint}`,
    );
    assertStringIncludes(command, "Authorization: Bearer");
  }
});
