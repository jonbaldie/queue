// The production binary's permissions. Docker, CI, and startup regressions all
// build here; unrestricted write/network access supports runtime configuration.
import { ENV_VAR_NAMES } from "../src/config.ts";

export async function compileBinary(
  output = "queue",
  overrides: { env?: true } = {},
): Promise<void> {
  const permissions = [
    "--allow-read",
    "--allow-write",
    "--allow-net",
    overrides.env ? "--allow-env" : `--allow-env=${ENV_VAR_NAMES.join(",")}`,
    "--allow-sys",
  ];
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "compile",
      "--frozen",
      ...permissions,
      "--output",
      output,
      "main.ts",
    ],
    cwd: new URL("../", import.meta.url),
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) {
    throw new Error(`Compilation failed (exit ${result.code})`);
  }
}

if (import.meta.main) {
  if (Deno.args.length > 1) throw new Error("Usage: compile.ts [output-path]");
  await compileBinary(Deno.args[0]);
}
