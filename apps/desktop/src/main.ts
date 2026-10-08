import process from 'node:process';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import {
  detectPlatform,
  nodeSystemProbe,
  startManagedGuidedApplication,
  type ManagedGuidedApplication,
} from '@token-harness/platform';
import {
  DESKTOP_RELEASES_URL,
  desktopEnvironment,
  isDesktopNavigationAllowed,
  isExternalDesktopLink,
} from './policy.js';

const smokeRoot = process.argv.includes('--desktop-smoke')
  ? process.env['TOKEN_HARNESS_DESKTOP_SMOKE_ROOT']
  : undefined;
if (smokeRoot !== undefined) {
  const profile = join(smokeRoot, 'electron-profile');
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}

let window: BrowserWindow | null = null;
let active: ManagedGuidedApplication | null = null;
let listener = '';
let quitting = false;
let finishedQuit = false;
let launching: Promise<void> | null = null;
let choosingProject = false;
const backends = new Set<ManagedGuidedApplication>();

function fail(error: unknown): void {
  const message =
    error instanceof Error ? error.message : 'The desktop application could not start.';
  if (smokeRoot !== undefined) console.error(message);
  else dialog.showErrorBox('Token Harness', message);
}

async function startProject(project: string): Promise<void> {
  const detection = detectPlatform(nodeSystemProbe());
  if (!detection.ok) throw new Error('This desktop platform is not supported.');
  const resources = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), '..', 'resources');
  const runtimeDirectory = join(resources, 'runtime');
  const home = smokeRoot === undefined ? app.getPath('home') : join(smokeRoot, 'home');
  const additionalPaths = [
    join(home, '.local', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.bun', 'bin'),
  ];
  if (process.platform === 'darwin') additionalPaths.push('/opt/homebrew/bin', '/usr/local/bin');
  if (process.platform === 'win32' && process.env['APPDATA'] !== undefined)
    additionalPaths.push(join(process.env['APPDATA'], 'npm'));
  const env = desktopEnvironment({
    env: process.env,
    runtimeDirectory,
    additionalPaths,
    windows: process.platform === 'win32',
  });
  if (smokeRoot !== undefined) {
    Object.assign(env, {
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_STATE_HOME: join(home, '.local', 'state'),
      XDG_CACHE_HOME: join(home, '.cache'),
      CODEX_HOME: join(home, '.codex'),
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      PATH: runtimeDirectory,
    });
    if (process.platform === 'win32') {
      for (const key of Object.keys(env))
        if (key.toLowerCase() === 'path' && key !== 'PATH') delete env[key];
    }
  }
  const backend = await startManagedGuidedApplication({
    executable: join(runtimeDirectory, process.platform === 'win32' ? 'node.exe' : 'node'),
    entryScript: join(resources, 'backend', 'token-harness.mjs'),
    cwd: project,
    env,
    facts: detection.facts,
  });
  backends.add(backend);
  if (quitting) {
    await backend.stop();
    return;
  }
  const previous = active;
  const previousListener = listener;
  active = backend;
  listener = backend.url;
  if (window === null) {
    window = new BrowserWindow({
      width: 1200,
      height: 850,
      minWidth: 720,
      minHeight: 540,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalDesktopLink(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (isDesktopNavigationAllowed(url, listener)) return;
      event.preventDefault();
      if (isExternalDesktopLink(url)) void shell.openExternal(url);
    });
    window.webContents.on('will-redirect', (event, url) => {
      if (!isDesktopNavigationAllowed(url, listener)) event.preventDefault();
    });
    window.on('closed', () => {
      window = null;
    });
  }
  try {
    await window.loadURL(backend.url);
  } catch (error) {
    active = previous;
    listener = previousListener;
    await backend.stop();
    backends.delete(backend);
    throw error;
  }
  window.setTitle(`Token Harness — ${project}`);
  if (smokeRoot === undefined) window.show();
  if (previous !== null) {
    await previous.stop();
    backends.delete(previous);
  }
  void backend.closed.then(() => {
    backends.delete(backend);
    if (!quitting && active === backend) {
      fail(new Error('The local backend stopped. Reopen Token Harness to reconnect.'));
      app.quit();
    }
  });
}

async function openProject(): Promise<void> {
  if (launching !== null || choosingProject || quitting || window === null) return;
  choosingProject = true;
  const selected = await dialog
    .showOpenDialog(window, { properties: ['openDirectory'] })
    .finally(() => {
      choosingProject = false;
    });
  if (quitting) return;
  const project = selected.filePaths[0];
  if (selected.canceled || project === undefined) return;
  launching = startProject(project);
  try {
    await launching;
  } catch (error) {
    fail(error);
  } finally {
    launching = null;
  }
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (finishedQuit) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void (async () => {
    await launching?.catch(() => undefined);
    await Promise.all([...backends].map((backend) => backend.stop()));
    finishedQuit = true;
    app.quit();
  })();
});

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'File',
        submenu: [
          {
            label: 'Open project…',
            accelerator: 'CmdOrCtrl+O',
            click: () => {
              void openProject();
            },
          },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Download desktop updates',
            click: () => {
              void shell.openExternal(DESKTOP_RELEASES_URL);
            },
          },
        ],
      },
    ]),
  );
  const home = smokeRoot === undefined ? app.getPath('home') : join(smokeRoot, 'home');
  launching = startProject(home);
  try {
    await launching;
    launching = null;
    if (smokeRoot !== undefined && window !== null) {
      const result: unknown = await window.webContents.executeJavaScript(`(async () => {
        const session = await fetch('/api/session');
        const html = document.documentElement.outerHTML;
        return { session: session.status, dashboard: html.includes('Token Harness'), privileged: typeof window.require !== 'undefined' };
      })()`);
      console.log(JSON.stringify({ desktopSmoke: result, version: app.getVersion() }));
      app.quit();
    }
  } catch (error) {
    launching = null;
    fail(error);
    process.exitCode = 1;
    app.quit();
  }
});
