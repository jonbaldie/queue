export function parsePositiveIntegerOption(
  args: readonly string[],
  optionName: string,
  defaultValue?: number,
): number | undefined {
  const option = `--${optionName}`;
  let rawValue: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];

    if (argument === option) {
      if (rawValue !== undefined) {
        throw new Error(`${option} may only be supplied once`);
      }

      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${option} must be a positive integer`);
      }

      rawValue = value;
      index++;
      continue;
    }

    if (argument.startsWith(`${option}=`)) {
      if (rawValue !== undefined) {
        throw new Error(`${option} may only be supplied once`);
      }

      rawValue = argument.slice(option.length + 1);
      continue;
    }

    throw new Error(
      `Unexpected argument '${argument}'. Expected ${option} <positive-integer>`,
    );
  }

  if (rawValue === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${option} must be a positive integer`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${option} must be a positive integer`);
  }

  return value;
}

export function buildStrykerCommandArgs(
  configFilePath: string,
  concurrency?: number,
): string[] {
  const args = ["--no-install", "stryker", "run"];
  if (concurrency !== undefined) {
    args.push("--concurrency", String(concurrency));
  }
  args.push(configFilePath);
  return args;
}
