/**
 * Redaction — RFC 0004 §Process policy and §Credentials.
 *
 * "Redact secrets from displayed commands and logs" and "redacts environment
 * variables matching secret-name patterns".
 *
 * This lives in `core` rather than in the platform package because redaction is
 * pure string work with no filesystem or process dependency, and because its
 * output lands in `Diagnostic.message` and `Evidence.detail`, which are core
 * types. RFC 0002 §Process abstraction makes redaction part of the process
 * runner's contract; the contract belongs where the other contracts are, and
 * the implementation that spawns belongs in the platform package.
 */

/**
 * The replacement token. ASCII, so a golden transcript containing it stays
 * byte-comparable on every platform.
 */
export const REDACTED = '[redacted]';

/**
 * Environment-variable names whose *values* are never displayed.
 *
 * Each pattern is anchored on `_` or a string boundary, which is what keeps
 * `PWD` (the POSIX working directory) and `SESSIONNAME` (a Windows terminal
 * name) out of the set while still catching `NPM_TOKEN`, `XDG_SESSION_ID`, and
 * `AWS_SECRET_ACCESS_KEY`.
 */
export const SECRET_NAME_PATTERNS: readonly RegExp[] = [
  /(?:^|_)TOKENS?(?:_|$)/i,
  /(?:^|_)SECRETS?(?:_|$)/i,
  /(?:^|_)PASSWORDS?(?:_|$)/i,
  /(?:^|_)PASSWD(?:_|$)/i,
  /(?:^|_)PASSPHRASE(?:_|$)/i,
  /(?:^|_)API_?KEYS?(?:_|$)/i,
  /(?:^|_)KEYS?(?:_|$)/i,
  /(?:^|_)CREDENTIALS?(?:_|$)/i,
  /(?:^|_)AUTHORIZATION(?:_|$)/i,
  /(?:^|_)AUTH_TOKEN(?:_|$)/i,
  /(?:^|_)SESSION(?:_|$)/i,
  /(?:^|_)COOKIES?(?:_|$)/i,
  /(?:^|_)PRIVATE_KEY(?:_|$)/i,
];

/** Flags whose following value, or `=value` suffix, is a secret. */
export const DEFAULT_SECRET_ARG_FLAGS: readonly string[] = [
  '--token',
  '--auth-token',
  '--password',
  '--passphrase',
  '--secret',
  '--api-key',
  '--apikey',
  '--credential',
  '--credentials',
  '--authorization',
];

export function isSecretEnvName(name: string): boolean {
  return SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * A displayable copy of an environment. Secret-named variables keep their key —
 * the *presence* of a credential is diagnostic information — and lose their
 * value. Unset variables are dropped, so the result is a plain record.
 */
export function redactEnvironmentForDisplay(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(env).sort()) {
    const value = env[key];
    if (value === undefined) continue;
    out[key] = isSecretEnvName(key) ? REDACTED : value;
  }
  return out;
}

/**
 * The values of secret-named variables, which the runner adds to its redaction
 * set so a child that echoes `$GITHUB_TOKEN` back at us does not leak it into a
 * captured stream.
 *
 * Values shorter than four characters are excluded: replacing a two-character
 * string everywhere would corrupt unrelated output while protecting a secret
 * that is not one.
 */
export const MINIMUM_REDACTABLE_LENGTH = 4;

export function secretValuesIn(env: Readonly<Record<string, string | undefined>>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value.length < MINIMUM_REDACTABLE_LENGTH) continue;
    if (isSecretEnvName(key)) out.push(value);
  }
  return out;
}

export interface RedactionPolicy {
  /** Literal values replaced wherever they appear. RFC 0002: "declared sensitive values". */
  secretValues: readonly string[];
  /** Flags whose value is a secret, in addition to the defaults. */
  secretArgFlags: readonly string[];
}

export function redactionPolicy(init?: Partial<RedactionPolicy>): RedactionPolicy {
  return {
    secretValues: init?.secretValues ?? [],
    secretArgFlags: [...DEFAULT_SECRET_ARG_FLAGS, ...(init?.secretArgFlags ?? [])],
  };
}

/** Replaces every declared secret value in `text`. Longest values first, so a value that contains another is redacted whole. */
export function redactText(text: string, policy: RedactionPolicy): string {
  let out = text;
  const values = [...policy.secretValues]
    .filter((value) => value.length >= MINIMUM_REDACTABLE_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const value of values) {
    // split/join rather than a RegExp: the value is arbitrary text and must not
    // be interpreted as a pattern.
    out = out.split(value).join(REDACTED);
  }
  return out;
}

function isSecretFlag(arg: string, policy: RedactionPolicy): boolean {
  return policy.secretArgFlags.some((flag) => flag.toLowerCase() === arg.toLowerCase());
}

function splitInlineFlag(arg: string): { flag: string; value: string } | null {
  const index = arg.indexOf('=');
  if (!arg.startsWith('-') || index <= 0) return null;
  return { flag: arg.slice(0, index), value: arg.slice(index + 1) };
}

/**
 * A displayable copy of an argument array.
 *
 * `--token abc` and `--token=abc` are both handled, because a plain-text secret
 * on a displayed command line is the leak this exists to prevent and the two
 * spellings are equally common.
 */
export function redactArguments(args: readonly string[], policy: RedactionPolicy): string[] {
  const out: string[] = [];
  let previousWasSecretFlag = false;
  for (const arg of args) {
    if (previousWasSecretFlag) {
      out.push(REDACTED);
      previousWasSecretFlag = false;
      continue;
    }
    const inline = splitInlineFlag(arg);
    if (inline !== null && isSecretFlag(inline.flag, policy)) {
      out.push(`${inline.flag}=${REDACTED}`);
      continue;
    }
    previousWasSecretFlag = isSecretFlag(arg, policy);
    out.push(redactText(arg, policy));
  }
  return out;
}

function quoteForDisplay(value: string): string {
  if (value === '') return '""';
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * The command as a human should see it in a plan, a diagnostic, or a log line.
 *
 * This string is never parsed and never executed. The runner always spawns an
 * executable plus an argument array (RFC 0004 §Process policy), so the quoting
 * here only has to be unambiguous to a reader — it is deliberately not a shell
 * escaping function, and nothing may reuse it as one.
 */
export function formatDisplayCommand(
  executable: string,
  args: readonly string[],
  policy: RedactionPolicy,
): string {
  const parts = [redactText(executable, policy), ...redactArguments(args, policy)];
  return parts.map(quoteForDisplay).join(' ');
}
