import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function contactConfiguration(value) {
  if (!value) return { endpoint: null };
  if (!/^https:\/\/formspree\.io\/f\/[a-zA-Z0-9]+$/.test(value)) {
    throw new Error(
      'CONTACT_FORM_ENDPOINT must be a Formspree /f/ ID URL, without an email address.',
    );
  }
  return { endpoint: value };
}

export function contactPage(html, endpoint) {
  const config = contactConfiguration(endpoint);
  if (!config.endpoint) return html;
  // These explicit template markers keep the native form usable without JavaScript.
  const replacements = [
    ['method="post" hidden', `method="post" action="${config.endpoint}"`],
    ['class="contact-fields" disabled', 'class="contact-fields"'],
    ['id="contact-fallback"', 'id="contact-fallback" hidden'],
  ];
  for (const [marker, replacement] of replacements) {
    if (html.split(marker).length !== 2) throw new Error('Contact page template marker changed.');
    html = html.replace(marker, replacement);
  }
  return html;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = contactConfiguration(process.env.CONTACT_FORM_ENDPOINT);
    const root = fileURLToPath(new URL('../', import.meta.url));
    const site = fileURLToPath(new URL('../site/', import.meta.url));
    const output = fileURLToPath(new URL('../dist/landing/', import.meta.url));
    if (relative(root, output) !== join('dist', 'landing')) {
      throw new Error('Landing output must stay inside the project build directory.');
    }
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await cp(site, output, { recursive: true });
    const pageUrl = new URL('../dist/landing/contact/index.html', import.meta.url);
    const html = await readFile(pageUrl, 'utf8');
    await writeFile(pageUrl, contactPage(html, config.endpoint));
    console.log(`Landing prepared; email contact ${config.endpoint ? 'enabled' : 'unconfigured'}.`);
  } catch (error) {
    console.error(`Landing preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
