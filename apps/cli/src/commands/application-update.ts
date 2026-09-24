import {
  compareVersions,
  diagnostic,
  parseSemanticVersion,
  queryAvailableVersion,
  queryPackageInventory,
  type ApplicationUpdateRow,
  type Diagnostic,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

const PACKAGE_NAME = 'token-harness';

export interface ApplicationUpdateInspection {
  row: ApplicationUpdateRow;
  /** The exact package directory from which this process was launched, when verified. */
  installationRoot: string | null;
  diagnostics: Diagnostic[];
  destination: string | null;
}

function unsupported(message: string, remediation: string): ApplicationUpdateInspection {
  return {
    row: {
      applicationId: PACKAGE_NAME,
      installed: null,
      available: null,
      channel: null,
      verdict: 'unsupported-installation',
    },
    installationRoot: null,
    destination: null,
    diagnostics: [
      diagnostic({
        severity: 'info',
        code: 'application-update-installation-unsupported',
        subject: PACKAGE_NAME,
        message,
        remediation,
      }),
    ],
  };
}

function sameDirectory(
  fs: NonNullable<CommandContext['adapters']>['fs'],
  first: string,
  second: string,
): boolean {
  return fs.isInside(first, second) && fs.isInside(second, first);
}

/**
 * Checks the running package only when its resolved entry point is inside npm's current global
 * package root. Source checkouts, npx caches and other package-manager installs stay read-only.
 */
export async function inspectApplicationUpdate(
  context: CommandContext,
): Promise<ApplicationUpdateInspection | null> {
  const adapters = context.adapters;
  const entryScript = context.applicationEntryScript;
  if (adapters === null || entryScript === undefined || entryScript === null) return null;

  const canonicalPath = adapters.fs.canonicalPath;
  if (canonicalPath === undefined) {
    return unsupported(
      'The running Token Harness installation path cannot be verified by this filesystem adapter',
      'Install Token Harness globally with npm to enable application updates',
    );
  }

  const entry = await canonicalPath.call(adapters.fs, entryScript);
  if (entry === null) {
    return unsupported(
      'The Token Harness entry script could not be resolved to an installed package',
      'Install Token Harness globally with npm to enable application updates',
    );
  }
  let packageRoot: string | null = null;
  let manifest: Record<string, unknown> | null = null;
  let candidateDirectory = adapters.fs.dirname(entry);
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const candidate = JSON.parse(
        new TextDecoder().decode(
          await adapters.fs.readFile(adapters.fs.join(candidateDirectory, 'package.json')),
        ),
      ) as unknown;
      if (
        typeof candidate === 'object' &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        (candidate as Record<string, unknown>)['name'] === PACKAGE_NAME &&
        typeof (candidate as Record<string, unknown>)['version'] === 'string' &&
        parseSemanticVersion((candidate as Record<string, unknown>)['version'] as string) !== null
      ) {
        packageRoot = candidateDirectory;
        manifest = candidate as Record<string, unknown>;
        break;
      }
    } catch {
      // Published bundles and package-manager shims place the entry at different depths. The
      // package manifest identifies the owning directory without assuming a particular layout.
    }
    const parent = adapters.fs.dirname(candidateDirectory);
    if (parent === candidateDirectory) break;
    candidateDirectory = parent;
  }
  if (packageRoot === null || manifest === null) {
    return unsupported(
      'The running Token Harness package manifest could not be identified safely',
      'Reinstall Token Harness with `npm install --global token-harness@latest`',
    );
  }
  const installed = manifest['version'] as string;

  const globalRootResult = await adapters.runner.run({
    executable: 'npm',
    args: ['root', '--global'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (globalRootResult.failure !== null || globalRootResult.exitCode !== 0) {
    return {
      row: {
        applicationId: PACKAGE_NAME,
        installed,
        available: null,
        channel: 'npm',
        verdict: 'unavailable',
      },
      installationRoot: packageRoot,
      destination: null,
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'application-update-channel-unavailable',
          subject: PACKAGE_NAME,
          message: 'npm could not report its global package root, so Token Harness was not updated',
          remediation: 'Restore npm on PATH, then check for updates again',
        }),
      ],
    };
  }

  const globalRootText = globalRootResult.stdout.trim();
  const globalRoot =
    globalRootText === '' ? null : await canonicalPath.call(adapters.fs, globalRootText);
  const expectedPackageRoot =
    globalRoot === null
      ? null
      : await canonicalPath.call(adapters.fs, adapters.fs.join(globalRoot, PACKAGE_NAME));
  if (
    expectedPackageRoot === null ||
    !sameDirectory(adapters.fs, packageRoot, expectedPackageRoot)
  ) {
    return {
      row: {
        applicationId: PACKAGE_NAME,
        installed,
        available: null,
        channel: null,
        verdict: 'unsupported-installation',
      },
      installationRoot: null,
      destination: null,
      diagnostics: [
        diagnostic({
          severity: 'info',
          code: 'application-update-installation-unsupported',
          subject: PACKAGE_NAME,
          message:
            'This Token Harness process is not running from npm’s global Token Harness package, so automatic self-update is unavailable',
          remediation:
            'For this installation, update it with its original method. The supported global npm command is `npm install --global token-harness@latest`',
        }),
      ],
    };
  }

  const inventory = await queryPackageInventory({
    channel: 'npm',
    packageName: PACKAGE_NAME,
    runner: adapters.runner,
    cwd: context.projectRoot,
  });
  if (inventory.status !== 'captured' || inventory.version !== installed) {
    return {
      row: {
        applicationId: PACKAGE_NAME,
        installed,
        available: null,
        channel: 'npm',
        verdict: inventory.status === 'failed' ? 'unavailable' : 'unknown',
      },
      installationRoot: packageRoot,
      destination: null,
      diagnostics: [
        ...inventory.diagnostics,
        diagnostic({
          severity: 'warning',
          code: 'application-update-inventory-unverified',
          subject: PACKAGE_NAME,
          message:
            'npm global inventory did not confirm the Token Harness version this process is running',
          remediation:
            'Check npm’s global prefix and duplicate Token Harness installations before updating',
        }),
      ],
    };
  }

  const query = await queryAvailableVersion({
    packageManager: 'npm',
    packageName: PACKAGE_NAME,
    runner: adapters.runner,
    cwd: context.projectRoot,
  });
  const row: ApplicationUpdateRow = {
    applicationId: PACKAGE_NAME,
    installed,
    available: query.version,
    channel: 'npm',
    verdict:
      query.status !== 'found' || query.version === null
        ? query.status === 'failed'
          ? 'unavailable'
          : 'unknown'
        : compareVersions(parseSemanticVersion(query.version)!, parseSemanticVersion(installed)!) >
            0
          ? 'upgradable'
          : 'current',
  };
  return {
    row,
    installationRoot: packageRoot,
    destination: query.destination,
    diagnostics: query.diagnostics,
  };
}

/** Re-reads both npm's global prefix and inventory after the package install. */
export async function verifyApplicationUpdate(
  context: CommandContext,
  expectedRoot: string,
  expectedVersion: string,
): Promise<Diagnostic[]> {
  const adapters = context.adapters;
  const fs = adapters?.fs;
  if (adapters === null || fs === undefined || fs.canonicalPath === undefined) {
    return [
      diagnostic({
        severity: 'error',
        code: 'application-update-version-not-observed',
        subject: PACKAGE_NAME,
        message: 'Token Harness could not verify its npm installation after the update',
        remediation:
          'Check the npm global package and run `npm install --global token-harness@latest` if needed',
      }),
    ];
  }

  const canonicalPath = fs.canonicalPath;
  const globalRootResult = await adapters.runner.run({
    executable: 'npm',
    args: ['root', '--global'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  const globalRootText = globalRootResult.stdout.trim();
  const globalRoot =
    globalRootResult.failure === null && globalRootResult.exitCode === 0 && globalRootText !== ''
      ? await canonicalPath.call(fs, globalRootText)
      : null;
  const observedRoot =
    globalRoot === null ? null : await canonicalPath.call(fs, fs.join(globalRoot, PACKAGE_NAME));
  const manifestPath = fs.join(expectedRoot, 'package.json');
  let installedVersion: string | null = null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(await fs.readFile(manifestPath))) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>)['name'] === PACKAGE_NAME &&
      typeof (parsed as Record<string, unknown>)['version'] === 'string'
    ) {
      installedVersion = (parsed as Record<string, string>)['version'] ?? null;
    }
  } catch {
    // The inventory query below supplies the actionable failure if the package manifest vanished.
  }
  const inventory = await queryPackageInventory({
    channel: 'npm',
    packageName: PACKAGE_NAME,
    runner: adapters.runner,
    cwd: context.projectRoot,
  });
  const target = parseSemanticVersion(expectedVersion);
  const manifestVersion = installedVersion === null ? null : parseSemanticVersion(installedVersion);
  const inventoryVersion =
    inventory.status === 'captured' && inventory.version !== null
      ? parseSemanticVersion(inventory.version)
      : null;
  const valid =
    observedRoot !== null &&
    sameDirectory(fs, observedRoot, expectedRoot) &&
    target !== null &&
    manifestVersion !== null &&
    compareVersions(manifestVersion, target) === 0 &&
    inventoryVersion !== null &&
    compareVersions(inventoryVersion, target) === 0;
  if (!valid) {
    return [
      ...inventory.diagnostics,
      diagnostic({
        severity: 'error',
        code: 'application-update-version-not-observed',
        subject: PACKAGE_NAME,
        path: expectedRoot,
        message: `The npm global installation did not verify Token Harness ${expectedVersion} after the update`,
        remediation:
          'Check npm’s global prefix and package inventory. Reinstall with `npm install --global token-harness@latest` only after confirming the correct prefix.',
      }),
    ];
  }
  return [
    diagnostic({
      severity: 'info',
      code: 'application-update-version-verified',
      subject: PACKAGE_NAME,
      path: expectedRoot,
      message: `Token Harness ${expectedVersion} is installed in the same verified npm global package directory`,
      remediation: null,
    }),
  ];
}
