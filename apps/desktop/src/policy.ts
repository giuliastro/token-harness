export const DESKTOP_RELEASES_URL = 'https://github.com/giuliastro/token-harness/releases';

export function isDesktopNavigationAllowed(target: string, listener: string): boolean {
  try {
    const url = new URL(target);
    return url.origin === new URL(listener).origin && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

export function isExternalDesktopLink(target: string): boolean {
  try {
    const url = new URL(target);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** Preserve the user's PATH preference; supplement GUI launchers' common missing locations. */
export function desktopEnvironment(input: {
  env: Readonly<Record<string, string | undefined>>;
  runtimeDirectory: string;
  additionalPaths: readonly string[];
  windows: boolean;
}): Record<string, string | undefined> {
  const pathKey = input.windows
    ? (Object.keys(input.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH')
    : 'PATH';
  const delimiter = input.windows ? ';' : ':';
  const paths = [
    ...(input.env[pathKey]?.split(delimiter) ?? []),
    ...input.additionalPaths,
    input.runtimeDirectory,
  ].filter((path) => path !== '');
  const seen = new Set<string>();
  const unique = paths.filter((path) => {
    const key = input.windows ? path.toLowerCase() : path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...input.env, [pathKey]: unique.join(delimiter) };
}
