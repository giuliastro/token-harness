/**
 * The golden-file normalizer — RFC 0006 §Golden-file determinism.
 *
 * The RFC says "Golden comparisons normalize", and that is meant literally: the
 * normalizer runs over *both* operands. That is what makes the transcripts in
 * §Golden path usable verbatim as golden files. `~/.claude/settings.json` and an
 * absolute Windows home path both reduce to `<home>/.claude/settings.json`;
 * `7f3a91c2` and a freshly computed digest both reduce to `<id:1>`; the literal
 * tokens `<project>` and `<state>` that already appear in the plan transcript
 * are fixed points.
 *
 * The five steps run in the order the RFC lists them. Line endings are folded
 * first because the step is order-independent and every later pattern is
 * written against `\n`.
 *
 * "Everything else is compared byte-for-byte. Provider and harness versions are
 * *not* normalized: they come from fixtures and are part of the expected
 * output." Node and OS versions come from fixtures too, so they are left alone
 * for the same reason.
 */

export interface NormalizeOptions {
  /** The Token Harness version to fold away. Only the anchored occurrence. */
  toolVersion: string;
  /** Absolute project root, or null when the scenario has none. */
  projectRoot?: string | null;
  /** Absolute Token Harness state root, or null. */
  stateRoot?: string | null;
  /** Absolute home directory, or null. */
  home?: string | null;
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every spelling of a root that can appear in output: the raw path, the same
 * path with POSIX separators, and — for a root under the home directory — the
 * `~`-abbreviated form the renderers emit.
 */
function rootSpellings(root: string, home: string | null): string[] {
  const spellings = new Set<string>([
    root,
    toPosix(root),
    // The JSON goldens are compared as text, so a Windows root also appears in
    // its JSON-escaped spelling.
    root.replace(/\\/g, '\\\\'),
  ]);
  if (home !== null && home !== '') {
    const posixHome = toPosix(home);
    const posixRoot = toPosix(root);
    if (posixRoot === posixHome) {
      spellings.add('~');
    } else if (posixRoot.startsWith(`${posixHome}/`)) {
      spellings.add(`~/${posixRoot.slice(posixHome.length + 1)}`);
    }
  }
  return [...spellings].filter((value) => value.length > 0);
}

/** Step 1: the Token Harness version, anchored so provider versions survive. */
function normalizeToolVersion(text: string, toolVersion: string): string {
  const version = escapeRegExp(toolVersion);
  return text
    .replace(new RegExp(`(Token Harness )${version}\\b`, 'g'), '$1<version>')
    .replace(new RegExp(`("toolVersion": ")${version}(")`, 'g'), '$1<version>$2');
}

/** Step 2: absolute paths, replaced by `<project>`, `<state>`, and `<home>`. */
function normalizePaths(text: string, options: NormalizeOptions): string {
  const home = options.home ?? null;
  const roots: Array<{ token: string; root: string }> = [];
  if (options.projectRoot != null) roots.push({ token: '<project>', root: options.projectRoot });
  if (options.stateRoot != null) roots.push({ token: '<state>', root: options.stateRoot });
  if (home != null) roots.push({ token: '<home>', root: home });

  const replacements: Array<{ token: string; spelling: string }> = [];
  for (const { token, root } of roots) {
    for (const spelling of rootSpellings(root, home)) replacements.push({ token, spelling });
  }
  // Longest spelling first, so a state root nested inside the home directory is
  // tokenized as `<state>` and not as `<home>/AppData/...`.
  replacements.sort((a, b) => b.spelling.length - a.spelling.length);

  let output = text;
  for (const { token, spelling } of replacements) {
    output = output.replaceAll(spelling, token);
  }
  // The tail of a tokenized path still carries platform separators, in raw or
  // JSON-escaped form. The golden files are written with `/`, so fold them.
  return output.replace(
    /(<(?:project|state|home)>)((?:\\{1,2}[^\s"\\]*)+)/g,
    (_match, token: string, tail: string) => `${token}${tail.replace(/\\{1,2}/g, '/')}`,
  );
}

/** Step 3: timestamps and durations. */
function normalizeTimestamps(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g, '<timestamp>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, '<duration>');
}

/**
 * Step 4: plan, pipeline, and transaction IDs, replaced by stable ordinals.
 *
 * An ID is a lowercase hex token of at least four characters that contains both
 * a digit and a letter. The two conditions are what keep the pattern off English
 * words made of hex letters (`added`, `decade`) and off bare years and grouped
 * numbers — and step 3 has already removed dates by the time this runs.
 */
function normalizeIds(text: string): string {
  const ordinals = new Map<string, string>();
  return text.replace(
    /\b(?=[0-9a-f]{4,64}\b)(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{4,64}\b/g,
    (match) => {
      let token = ordinals.get(match);
      if (token === undefined) {
        token = `<id:${ordinals.size + 1}>`;
        ordinals.set(match, token);
      }
      return token;
    },
  );
}

/** Step 5: line endings. Folded first; the step does not interact with the others. */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function normalizeGolden(text: string, options: NormalizeOptions): string {
  let output = normalizeLineEndings(text);
  output = normalizeToolVersion(output, options.toolVersion);
  output = normalizePaths(output, options);
  output = normalizeTimestamps(output);
  output = normalizeIds(output);
  return output;
}
