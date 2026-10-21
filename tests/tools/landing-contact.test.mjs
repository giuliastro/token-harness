import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { contactConfiguration, contactPage } from '../../scripts/prepare-landing.mjs';

test('contact build accepts only a public Formspree ID, never an address or another origin', () => {
  assert.deepEqual(contactConfiguration(''), { endpoint: null });
  assert.deepEqual(contactConfiguration('https://formspree.io/f/example'), {
    endpoint: 'https://formspree.io/f/example',
  });
  for (const value of [
    'https://formspree.io/recipient@example.com',
    'https://formspree.io/f/example?email=recipient@example.com',
    'https://formspree.io.evil.test/f/example',
    'mailto:recipient@example.com',
    'http://formspree.io/f/example',
  ])
    assert.throws(() => contactConfiguration(value), /must be a Formspree/);
});

test('build enables the native form without JavaScript, and keeps fallback when unconfigured', async () => {
  const source = await readFile(new URL('../../site/contact/index.html', import.meta.url), 'utf8');
  const configured = contactPage(source, 'https://formspree.io/f/example');
  assert.match(configured, /method="post" action="https:\/\/formspree.io\/f\/example"/);
  assert.match(configured, /<fieldset class="contact-fields">/);
  assert.match(configured, /id="contact-fallback" hidden/);
  assert.equal(contactPage(source, null), source);
  assert.match(source, /method="post" hidden/);
  assert.match(source, /class="contact-fields" disabled/);
  assert.throws(
    () => contactPage('<form></form>', 'https://formspree.io/f/example'),
    /template marker/,
  );
  assert.throws(() => contactPage(source, 'https://example.test/f/example'), /must be a Formspree/);
});
