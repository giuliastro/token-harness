/* global document, window, localStorage, AbortController, fetch */
const themeButton = document.querySelector('.theme-toggle');
const themeMeta = document.querySelector('meta[name="theme-color"]');

try {
  const savedTheme = localStorage.getItem('token-harness-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.dataset.theme = savedTheme;
  }
} catch {
  // Theme selection remains usable when browser storage is unavailable.
}

function currentTheme() {
  return (
    document.documentElement.dataset.theme ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

function syncThemeButton() {
  const dark = currentTheme() === 'dark';
  themeButton.setAttribute('aria-pressed', String(dark));
  themeButton.textContent = dark ? 'Dark mode on' : 'Dark mode';
  themeMeta?.setAttribute('content', dark ? '#15171b' : '#f7f8fa');
}

themeButton.hidden = false;
syncThemeButton();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.documentElement.dataset.theme) syncThemeButton();
});
themeButton.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('token-harness-theme', next);
  } catch {
    /* Keep the current page selection. */
  }
  syncThemeButton();
});

const releaseEndpoint = 'https://api.github.com/repos/giuliastro/token-harness/releases/latest';
const releasePage = 'https://github.com/giuliastro/token-harness/releases/latest';
const assetByPlatform = {
  windows: (version) => `token-harness-${version}-windows-x64-setup.exe`,
  'mac-arm64': (version) => `token-harness-${version}-macos-arm64.dmg`,
  'mac-x64': (version) => `token-harness-${version}-macos-x64.dmg`,
  linux: (version) => `token-harness-${version}-linux-amd64.deb`,
};

async function updateReleaseLinks() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2600);
  try {
    const response = await fetch(releaseEndpoint, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) return;

    const release = await response.json();
    const versionMatch =
      typeof release.tag_name === 'string' && /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
    if (
      !versionMatch ||
      release.draft !== false ||
      release.prerelease !== false ||
      typeof release.published_at !== 'string' ||
      Number.isNaN(Date.parse(release.published_at))
    )
      return;

    const version = versionMatch[1];
    const assets = new Map();
    if (!Array.isArray(release.assets)) return;
    for (const asset of release.assets) {
      if (
        typeof asset?.name === 'string' &&
        asset.state === 'uploaded' &&
        Number.isSafeInteger(asset.size) &&
        asset.size > 0
      ) {
        assets.set(asset.name, asset);
      }
    }

    for (const link of document.querySelectorAll('[data-asset]')) {
      const makeName = assetByPlatform[link.dataset.asset];
      const expectedName = makeName?.(version);
      if (!expectedName || !assets.has(expectedName)) continue;
      link.href = `${releasePage.replace('/latest', `/download/${release.tag_name}`)}/${expectedName}`;
    }
  } catch {
    // The visible release-page links remain valid when the API is unavailable.
  } finally {
    window.clearTimeout(timeout);
  }
}

if (document.querySelector('[data-asset]')) updateReleaseLinks();
