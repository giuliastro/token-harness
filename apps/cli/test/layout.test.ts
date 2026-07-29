import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  column,
  displayPath,
  document,
  formatCount,
  rightAlign,
  shouldDecorate,
} from '../src/render/layout.js';

describe('layout', () => {
  it('pads to the column width', () => {
    assert.equal(column('rtk', 14), 'rtk           ');
    assert.equal(column('rtk', 14).length, 14);
  });

  it('never glues two columns together when a value overflows', () => {
    const wide = column('a-very-long-provider-identifier', 14);
    assert.equal(wide.endsWith('  '), true);
  });

  it('right-aligns figures', () => {
    assert.equal(rightAlign('412,006', 9), '  412,006');
  });

  it('groups numbers without consulting the locale', () => {
    assert.equal(formatCount(1204880), '1,204,880');
    assert.equal(formatCount(873478), '873,478');
    assert.equal(formatCount(402), '402');
    assert.equal(formatCount(0), '0');
    assert.equal(formatCount(-1234), '-1,234');
  });

  it('abbreviates the home directory and renders forward slashes on every platform', () => {
    assert.equal(
      displayPath('C:\\Users\\dev\\.claude\\settings.json', 'C:\\Users\\dev'),
      '~/.claude/settings.json',
    );
    assert.equal(
      displayPath('/home/dev/.claude/settings.json', '/home/dev'),
      '~/.claude/settings.json',
    );
    assert.equal(displayPath('C:\\Users\\dev', 'C:\\Users\\dev'), '~');
  });

  it('leaves a path outside the home directory absolute', () => {
    assert.equal(displayPath('C:\\work\\demo', 'C:\\Users\\dev'), 'C:/work/demo');
    assert.equal(displayPath('/opt/tools/rtk', '/home/dev'), '/opt/tools/rtk');
  });

  it('does not mistake a sibling directory for the home directory', () => {
    assert.equal(displayPath('C:\\Users\\developer\\x', 'C:\\Users\\dev'), 'C:/Users/developer/x');
  });

  it('trims trailing whitespace and terminates with exactly one newline', () => {
    assert.equal(document(['a   ', 'b', '', '']), 'a\nb\n');
  });

  it('suppresses decoration off a TTY, under NO_COLOR, and under --json', () => {
    assert.equal(shouldDecorate({ stdoutIsTty: true, noColor: false, json: false }), true);
    assert.equal(shouldDecorate({ stdoutIsTty: false, noColor: false, json: false }), false);
    assert.equal(shouldDecorate({ stdoutIsTty: true, noColor: true, json: false }), false);
    assert.equal(shouldDecorate({ stdoutIsTty: true, noColor: false, json: true }), false);
  });
});
