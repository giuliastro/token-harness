/**
 * Windows ACL evaluation — RFC 0004 §State directory permissions.
 *
 * ## Why SDDL rather than `icacls` output
 *
 * RFC 0004 says the mechanism is `icacls` through the process runner, and that the
 * effective ACL is "read back" and its ACEs asserted. It does not say *which*
 * icacls output to read, and the obvious one is a trap: plain `icacls <path>`
 * prints principal *names*, and those names are localised. On a German Windows the
 * Administrators group prints as `BUILTIN\Administratoren` and the system account
 * as `NT-AUTORITÄT\SYSTEM`. A name allowlist would therefore fail closed on every
 * non-English machine — technically safe, and completely unusable.
 *
 * `icacls <path> /save <file>` writes the security descriptor in SDDL, which is
 * SIDs and locale-independent aliases. That is what this module parses. The gap is
 * reported in the PR.
 *
 * ## The invariant
 *
 * "No principal other than the owning user, the local system, and local
 * administrators can read the state directory" — stated at that level because
 * owner-only would be false on both platforms, per the RFC.
 *
 * Everything here is pure, so the widened-inherited-ACL fixture the RFC requires
 * is a string in a table and runs on Linux and macOS too.
 */

/** Local System. */
const SID_SYSTEM = 'S-1-5-18';
/** The local `Administrators` group. */
const SID_ADMINISTRATORS = 'S-1-5-32-544';
/** `CREATOR OWNER` — a placeholder that resolves to the object's owner. */
const SID_CREATOR_OWNER = 'S-1-3-0';
/** `OWNER RIGHTS` — grants only what the owner already has. */
const SID_OWNER_RIGHTS = 'S-1-3-4';

/**
 * SDDL aliases accepted as equivalent to the permitted SIDs.
 *
 * Deliberately short: `LA` (the built-in Administrator *account*) and `AU`
 * (Authenticated Users) are not here, and an ACE naming either is reported. RFC
 * 0004 permits "local administrators", the group, not every account that happens
 * to be administrative — and a machine where a specific extra account was granted
 * read is exactly the widened-profile case the RFC describes.
 */
const PERMITTED_ALIASES: Readonly<Record<string, string>> = {
  SY: SID_SYSTEM,
  BA: SID_ADMINISTRATORS,
  CO: SID_CREATOR_OWNER,
  OW: SID_OWNER_RIGHTS,
};

export const WELL_KNOWN_PERMITTED_SIDS: readonly string[] = [
  SID_SYSTEM,
  SID_ADMINISTRATORS,
  SID_CREATOR_OWNER,
  SID_OWNER_RIGHTS,
];

/**
 * SDDL aliases that are *domain-relative*: they abbreviate a machine-specific SID
 * rather than a fixed one, so they cannot be compared as literals.
 *
 * This is not a theoretical concern. On a machine whose interactive user is the
 * built-in Administrator account — which is how the GitHub Windows runner is set up
 * — `whoami` reports `S-1-5-21-…-500` and `icacls` writes that same principal into
 * the descriptor as `LA`. Comparing the alias against the owner's raw SID rejects
 * the owner's own ACE, which is how this table came to exist: CI found it, on the
 * first push, on the platform PLAN §7 says to develop this layer on.
 *
 * The relative identifier is resolved against the prefix of the owner SID, which is
 * the same machine or domain authority.
 */
const DOMAIN_RELATIVE_RIDS: Readonly<Record<string, number>> = {
  LA: 500, // the built-in Administrator account
  LG: 501, // the built-in Guest account
  DA: 512, // Domain Admins
  DU: 513, // Domain Users
  DG: 514, // Domain Guests
  DC: 515, // Domain Computers
  DD: 516, // Domain Controllers
  CA: 517, // Cert Publishers
  SA: 518, // Schema Admins
  EA: 519, // Enterprise Admins
  PA: 520, // Group Policy Creator Owners
};

const MACHINE_SID = /^(S-1-5-21(?:-\d+){3})-\d+$/i;

/**
 * Expands an ACE principal to a comparable SID.
 *
 * A fixed alias becomes its fixed SID. A domain-relative alias becomes the owner's
 * authority plus its relative identifier — so `LA` is the owner when the owner is
 * account 500, and is a different principal when it is not. Anything else is
 * returned unchanged.
 */
export function resolveAcePrincipal(principal: string, ownerSid: string): string {
  const upper = principal.trim().toUpperCase();
  const fixed = PERMITTED_ALIASES[upper];
  if (fixed !== undefined) return fixed;
  const rid = DOMAIN_RELATIVE_RIDS[upper];
  const authority = MACHINE_SID.exec(ownerSid.trim().toUpperCase())?.[1];
  if (rid !== undefined && authority !== undefined) return `${authority}-${String(rid)}`;
  return upper;
}

export interface SddlAce {
  /** `A` allow, `D` deny, and the object/audit variants. */
  type: string;
  flags: readonly string[];
  /** The rights field verbatim: a run of two-letter tokens, or a hex mask. */
  rights: string;
  /** A SID, or the SDDL alias the descriptor used. Uppercased. */
  sid: string;
  /** True when the ACE carries the `ID` flag, meaning it arrived by inheritance. */
  inherited: boolean;
}

export interface ParsedSecurityDescriptor {
  owner: string | null;
  group: string | null;
  /** DACL control flags: `P` protected, `AI` auto-inherited, `AR` auto-inherit-request. */
  daclFlags: readonly string[];
  /** False when there is no `D:` section at all, which means a NULL DACL. */
  daclPresent: boolean;
  aces: readonly SddlAce[];
}

const CONTROL_FLAG_TOKENS = /^(P|AI|AR|NO_ACCESS_CONTROL)/;

function splitControlFlags(text: string): string[] {
  const flags: string[] = [];
  let rest = text;
  while (rest !== '') {
    const match = CONTROL_FLAG_TOKENS.exec(rest);
    if (match === null) break;
    flags.push(match[0]);
    rest = rest.slice(match[0].length);
  }
  return flags;
}

function twoLetterTokens(text: string): string[] {
  const tokens: string[] = [];
  for (let index = 0; index + 1 < text.length; index += 2) {
    tokens.push(text.slice(index, index + 2));
  }
  return tokens;
}

/**
 * Parses an SDDL security-descriptor string.
 *
 * Returns null for anything it does not fully understand. A descriptor that
 * cannot be parsed must not be reported as satisfying the invariant — the caller
 * turns null into `unverifiable`, which RFC 0004 treats the same as an
 * unreadable ACL: stop, do not continue.
 */
export function parseSecurityDescriptor(text: string): ParsedSecurityDescriptor | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const sections = new Map<string, string>();
  // Section markers are `O:`, `G:`, `D:`, `S:` at nesting depth zero. Splitting on
  // a regex would also match a `D:` inside a resource attribute, so depth is
  // tracked explicitly.
  let depth = 0;
  let current: string | null = null;
  let buffer = '';
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index] as string;
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;

    if (depth === 0 && trimmed[index + 1] === ':' && /^[OGDS]$/.test(char)) {
      if (current !== null) sections.set(current, buffer);
      current = char;
      buffer = '';
      index += 1;
      continue;
    }
    if (current === null) return null;
    buffer += char;
  }
  if (current !== null) sections.set(current, buffer);
  if (sections.size === 0) return null;

  const dacl = sections.get('D');
  const aces: SddlAce[] = [];
  let daclFlags: string[] = [];

  if (dacl !== undefined) {
    const firstAce = dacl.indexOf('(');
    daclFlags = splitControlFlags(firstAce === -1 ? dacl : dacl.slice(0, firstAce));
    for (const match of dacl.matchAll(/\(([^)]*)\)/g)) {
      const fields = (match[1] ?? '').split(';');
      const type = (fields[0] ?? '').trim().toUpperCase();
      const flags = twoLetterTokens((fields[1] ?? '').trim().toUpperCase());
      const rights = (fields[2] ?? '').trim().toUpperCase();
      const sid = (fields[5] ?? '').trim().toUpperCase();
      if (type === '' || sid === '') return null;
      aces.push({ type, flags, rights, sid, inherited: flags.includes('ID') });
    }
  }

  return {
    owner: sections.get('O')?.trim().toUpperCase() ?? null,
    group: sections.get('G')?.trim().toUpperCase() ?? null,
    daclFlags,
    daclPresent: dacl !== undefined,
    aces,
  };
}

/**
 * Rights tokens that let a holder read directory content or traverse into it.
 *
 * `FX`/`GX` are included: execute on a directory is traverse, and a principal that
 * can traverse can reach children whose own ACLs may be weaker.
 */
const READ_RIGHT_TOKENS = new Set(['GA', 'GR', 'GX', 'FA', 'FR', 'FX', 'KA', 'KR', 'KX']);

/** Access-mask bits that reveal content: list/read data, traverse, and the generics. */
const READ_MASK = 0x1 | 0x8 | 0x20 | 0x10000000 | 0x20000000 | 0x80000000;

/**
 * Whether an ACE's rights field grants read access.
 *
 * Fails closed. A rights field this function cannot decompose is treated as
 * granting read, so an unrecognised spelling produces a refusal rather than a
 * silent pass.
 */
export function grantsRead(rights: string): boolean {
  const normalized = rights.trim().toUpperCase();
  if (normalized === '') return true;
  if (/^0X[0-9A-F]+$/.test(normalized)) {
    const mask = Number.parseInt(normalized.slice(2), 16);
    return Number.isNaN(mask) ? true : (mask & READ_MASK) !== 0;
  }
  if (!/^([A-Z]{2})+$/.test(normalized)) return true;
  return twoLetterTokens(normalized).some((token) => READ_RIGHT_TOKENS.has(token));
}

export interface AclEvaluation {
  /** True when no principal outside the permitted set holds read access. */
  ok: boolean;
  /** SIDs or aliases that hold read access and should not. Sorted, deduplicated. */
  unexpectedPrincipals: readonly string[];
  /** True when the DACL carries `P`, so a later widening of the parent cannot propagate in. */
  inheritanceBlocked: boolean;
}

/**
 * Evaluates a security descriptor against the RFC 0004 invariant.
 *
 * `ownerSid` is the current user's SID, obtained from `whoami` rather than assumed,
 * because the SDDL contains no indication of which of its SIDs is "us".
 *
 * Returns null when the descriptor could not be parsed.
 */
export function evaluateStateRootAcl(sddl: string, ownerSid: string): AclEvaluation | null {
  const parsed = parseSecurityDescriptor(sddl);
  if (parsed === null) return null;

  // A missing `D:` section is a NULL DACL, which grants everyone full control. It
  // is the most permissive state possible and the easiest to misread as "no rules
  // found, so nothing is wrong".
  if (!parsed.daclPresent || parsed.daclFlags.includes('NO_ACCESS_CONTROL')) {
    return { ok: false, unexpectedPrincipals: ['<null-dacl>'], inheritanceBlocked: false };
  }

  const permitted = new Set<string>([ownerSid.trim().toUpperCase(), ...WELL_KNOWN_PERMITTED_SIDS]);
  const unexpected = new Set<string>();

  for (const ace of parsed.aces) {
    // Deny ACEs restrict access; only allow ACEs can widen it. Object-type allow
    // ACEs (`OA`) are Active Directory constructs that never appear on a local
    // directory, but they allow, so they are counted.
    if (ace.type !== 'A' && ace.type !== 'OA') continue;
    // `IO` marks an ACE that applies only to children, not to this object.
    if (ace.flags.includes('IO')) continue;
    if (!grantsRead(ace.rights)) continue;
    if (permitted.has(resolveAcePrincipal(ace.sid, ownerSid))) continue;
    // Reported with the spelling the descriptor used, so a user pasting the
    // diagnostic into `icacls` sees what they will see.
    unexpected.add(ace.sid);
  }

  return {
    ok: unexpected.size === 0,
    unexpectedPrincipals: [...unexpected].sort(),
    inheritanceBlocked: parsed.daclFlags.includes('P'),
  };
}

/**
 * The `/grant:r` arguments that create the intended DACL.
 *
 * Granted by SID rather than by account name: `icacls` accepts `*S-1-...`, and
 * doing so removes both the localisation problem and the need to compose
 * `%USERDOMAIN%\%USERNAME%` correctly on a machine that may be domain-joined,
 * Azure-AD-joined, or using a Microsoft account.
 *
 * `(OI)(CI)` makes the entries inheritable so files created inside are protected
 * too; `(F)` is full control, which the owner needs and which `Administrators` and
 * `SYSTEM` have anyway.
 */
export function stateRootGrantArguments(ownerSid: string): string[] {
  return [
    `*${ownerSid}:(OI)(CI)(F)`,
    `*${SID_SYSTEM}:(OI)(CI)(F)`,
    `*${SID_ADMINISTRATORS}:(OI)(CI)(F)`,
  ];
}
