// `control-errand --run ID <command> [words] [--option value | --flag]`. Options are plain strings;
// the commands that take numbers or JSON parse and check them themselves.

export type OptionValue = string | true;
export type Options = Record<string, OptionValue>;

export interface ParsedArguments {
  readonly words: string[];
  readonly options: Options;
}

/** Options that never take a value. */
const FLAGS = new Set(["help", "headed", "live", "viewport", "json", "plan"]);

export function parseArguments(argv: readonly string[]): ParsedArguments {
  const words: string[] = [];
  const options: Options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? "";
    // `pnpm verify -- …` passes the separator through.
    if (argument === "--") continue;
    if (!argument.startsWith("--")) {
      words.push(argument);
      continue;
    }
    const option = argument.slice(2);
    const separator = option.indexOf("=");
    const name = separator < 0 ? option : option.slice(0, separator);
    if (separator >= 0) {
      options[name] = option.slice(separator + 1);
    } else if (FLAGS.has(name)) {
      options[name] = true;
    } else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --${name}; use --${name}=VALUE for values that start with --`);
      }
      options[name] = value;
      index++;
    }
  }
  return { words, options };
}

export function stringOption(options: Options, name: string): string | undefined {
  const value = options[name];
  if (value === undefined) return undefined;
  if (value === true) throw new Error(`--${name} needs a value`);
  return value;
}

export function integerOption(options: Options, name: string, min: number, max: number): number | undefined {
  const raw = stringOption(options, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`--${name} must be an integer ${min}-${max}`);
  return value;
}

export function jsonOption(options: Options, name: string): unknown {
  const raw = stringOption(options, name);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`--${name} must be JSON`);
  }
}
