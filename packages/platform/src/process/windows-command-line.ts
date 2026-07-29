/**
 * Windows command-interpreter quoting.
 *
 * ## The conflict this file resolves
 *
 * RFC 0004 §Process policy: "Use executable plus argument arrays. Avoid shell
 * interpolation." RFC 0002 §Process abstraction: "Shell strings are reserved for
 * upstream commands that strictly require a shell and must be marked as elevated
 * risk."
 *
 * On Windows a batch shim strictly requires one. `pnpm`, `npm`, `yarn`, and every
 * `bin` entry npm installs are `.cmd` files, and `CreateProcess` cannot start a
 * `.cmd` at all — since the fix for CVE-2024-27980, Node refuses to try. So the
 * options are: never run a package manager on Windows, guess at the shim's
 * internals, or go through `cmd.exe`. The third is the only one that works, and
 * neither RFC says who is then responsible for quoting, or what happens to an
 * argument that cannot be quoted safely. That gap is reported in the PR.
 *
 * ## The resolution
 *
 * The normal API stays shell-free: `spawn` with `shell: false` and an argument
 * array, always. A batch shim takes a *separate, named* path — recorded on the
 * outcome as `windows-command-interpreter` — that builds the command line here,
 * from the argument array, with no string interpolation anywhere.
 *
 * ## Why some arguments are rejected rather than escaped
 *
 * `cmd.exe` processes its command line in phases: `%VAR%` substitution happens
 * *before* caret escaping, and it happens inside double quotes. There is
 * therefore no way to pass a literal `%` through `cmd /c` and be sure it arrives
 * as one. `!` has the same problem whenever delayed expansion is active, and a
 * batch shim can turn it on itself with `setlocal enabledelayedexpansion`, so
 * passing `/v:off` only sets the initial state. A literal `"` is worse: even when
 * it is delivered correctly to `CommandLineToArgvW`, the callee here is a *batch
 * file*, whose own parsing of `%1` is not something this layer can analyse.
 *
 * So those characters are refused, with a named diagnostic, instead of escaped
 * with a guarantee that cannot be made. That is the same conclusion Rust reached
 * for the same conflict (CVE-2024-24576): escape what is provably safe, return an
 * error for the rest. In practice nothing Token Harness passes to a package
 * manager contains them — a version range, a package name, a flag, an absolute
 * path — so the restriction costs nothing and the guarantee is real.
 *
 * Everything else is delivered inside double quotes, where `cmd.exe`'s tokenizer
 * does not treat `& | < > ^ ( )` as special.
 *
 * This module is pure: it takes paths as strings and imports nothing.
 */

/** Characters that cannot be made inert inside `cmd /c`. See the module comment. */
const UNQUOTABLE = /[\0\r\n%!"]/;

const UNQUOTABLE_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\0/, 'a NUL byte'],
  [/[\r\n]/, 'a line break'],
  [/%/, 'a percent sign, which cmd.exe expands before any escaping applies'],
  [/!/, 'an exclamation mark, which cmd.exe expands when delayed expansion is active'],
  [/"/, 'a double quote, which a batch file re-parses in a way this layer cannot analyse'],
];

function describeUnquotable(value: string): string {
  for (const [pattern, name] of UNQUOTABLE_NAMES) {
    if (pattern.test(value)) return name;
  }
  return 'a character that cannot be escaped for cmd.exe';
}

export type QuoteResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Quotes one argument for delivery through `cmd /d /s /c`.
 *
 * Quotes are applied unconditionally rather than only when the value contains a
 * space: one code path is easier to reason about than two, and the quotes are
 * what neutralise the metacharacters.
 *
 * Trailing backslashes are doubled. `CommandLineToArgvW` treats a backslash run
 * immediately before a quote as an escape sequence, so `C:\dir\` would otherwise
 * arrive as `C:\dir"` with the closing quote swallowed — the bug that turns a
 * directory argument into an unterminated string.
 *
 * The doubling targets `CommandLineToArgvW`, which is what the program *behind* the
 * shim uses: an npm-generated `.cmd` forwards `%*` verbatim to a real executable,
 * and that executable un-doubles it. A batch file that reads `%~1` directly instead
 * performs its own naive quote-stripping and would see the doubled run. That is a
 * property of `%~1`, not something this function can fix for both callees at once,
 * and the forwarding shape is the one every package manager uses.
 */
export function quoteForCommandInterpreter(value: string): QuoteResult {
  if (UNQUOTABLE.test(value)) {
    return { ok: false, reason: `contains ${describeUnquotable(value)}` };
  }
  const trailing = /\\+$/.exec(value);
  const body =
    trailing === null ? value : value.slice(0, -trailing[0].length) + trailing[0].repeat(2);
  return { ok: true, text: `"${body}"` };
}

export interface CommandInterpreterInvocation {
  /** Absolute path to `cmd.exe`. */
  readonly interpreter: string;
  /**
   * Argument array for `spawn`, used with `windowsVerbatimArguments: true` so
   * Node does not re-quote the command line this module built.
   *
   * `/d` skips the `AutoRun` registry command, which would otherwise execute on
   * every interpreter start. `/s` makes the outer quote pair strippable, which is
   * what lets the inner quoting survive intact. `/v:off` sets delayed expansion
   * off initially. `/c` runs the line and exits.
   */
  readonly args: readonly string[];
}

export type CommandLineResult =
  | { readonly ok: true; readonly invocation: CommandInterpreterInvocation }
  | { readonly ok: false; readonly argument: string; readonly reason: string };

/**
 * Builds the full `cmd.exe` invocation for a batch shim.
 *
 * The command line is wrapped in one extra quote pair, which `/s` strips before
 * using the remainder verbatim. This is the same shape Node's own `shell: true`
 * produces; the difference is that every argument inside it came from an array
 * through {@link quoteForCommandInterpreter}, and none from a template.
 */
export function buildCommandInterpreterCommandLine(
  interpreter: string,
  executablePath: string,
  args: readonly string[],
): CommandLineResult {
  const parts: string[] = [];
  for (const value of [executablePath, ...args]) {
    const quoted = quoteForCommandInterpreter(value);
    if (!quoted.ok) return { ok: false, argument: value, reason: quoted.reason };
    parts.push(quoted.text);
  }
  return {
    ok: true,
    invocation: {
      interpreter,
      args: ['/d', '/s', '/v:off', '/c', `"${parts.join(' ')}"`],
    },
  };
}

/**
 * Locates `cmd.exe`.
 *
 * `%SystemRoot%` is preferred over `%COMSPEC%`. Both are environment variables,
 * but `COMSPEC` is conventionally *meant* to be redirected, so honouring it first
 * would let a modified environment choose the interpreter for a command Token
 * Harness runs on the user's behalf. `COMSPEC` remains the fallback because a
 * system with no `SystemRoot` is stranger than one with a redirected `COMSPEC`.
 */
export function resolveCommandInterpreter(
  env: Readonly<Record<string, string | undefined>>,
  join: (...segments: string[]) => string,
): string | null {
  const systemRoot = env['SystemRoot'] ?? env['windir'];
  if (systemRoot !== undefined && systemRoot.trim() !== '') {
    return join(systemRoot, 'System32', 'cmd.exe');
  }
  const comspec = env['COMSPEC'];
  if (comspec !== undefined && comspec.trim() !== '') return comspec;
  return null;
}
