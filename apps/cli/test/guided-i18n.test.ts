import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';
import { GUIDE_PRODUCT_JS, GUIDE_TRANSLATIONS } from '../src/guided-product-client.js';

/** English source text passed to t() is the translation key. */
function translatedKeys(source: string): string[] {
  const keys: string[] = [];
  for (const match of source.matchAll(/\bt\((['"])((?:\\.|(?!\1)[^\\])*)\1/g))
    keys.push(match[2]!.replace(/\\(['"\\])/g, '$1'));
  return keys;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('guided app translations', () => {
  it('ships a parseable controller', () => {
    assert.doesNotThrow(() => new Function(GUIDE_JS));
  });

  it('only translates literal English text', () => {
    const calls = [...GUIDE_PRODUCT_JS.matchAll(/\bt\(([^)]{0,12})/g)]
      .map((match) => match[1]!)
      // The definition itself and the static-shell pass (whose keys are checked below) are exempt.
      .filter(
        (argument) =>
          !/^['"]/.test(argument) &&
          !argument.startsWith('text, params') &&
          !argument.startsWith('element.data'),
      );
    assert.deepEqual(calls, []);
  });

  it('has an Italian translation for every interface text', () => {
    const keys = new Set([
      ...translatedKeys(GUIDE_PRODUCT_JS),
      ...[...GUIDE_HTML.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((match) => match[1]!),
    ]);
    assert.ok(keys.size > 300, String(keys.size));
    const missing = [...keys].filter((key) => !(key in GUIDE_TRANSLATIONS.it));
    assert.deepEqual(missing, []);
  });

  it('keeps every placeholder in the Italian text', () => {
    for (const [english, italian] of Object.entries(GUIDE_TRANSLATIONS.it)) {
      assert.ok(italian.trim().length > 0, english);
      assert.deepEqual(placeholders(italian), placeholders(english), english);
    }
  });
});
