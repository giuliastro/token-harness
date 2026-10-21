import assert from 'node:assert/strict';
import { it } from 'node:test';
import { startGuidedBrowser } from './guided-browser-double.js';

it('opens workload advice, submits bounded options and never applies a policy', async () => {
  const browser = await startGuidedBrowser({
    respond: (path) =>
      path === '/api/tools'
        ? {
            mode: 'plan',
            envelope: {
              schemaVersion: 1,
              command: 'optimize',
              exitCode: 0,
              diagnostics: [],
              data: { harnesses: [{ harnessId: 'codex', recommendedEffort: 'medium' }] },
            },
          }
        : undefined,
  });
  await browser.turn('details');
  browser.button(browser.get('details-root'), 'Plan my workload').fire('click');
  browser.get('tool-tasks-left').value = '5';
  browser.button(browser.get('modal-actions'), 'Get advice').fire('click');
  await browser.settle();
  const request = browser.writes.find((item) => item.path === '/api/tools');
  assert.deepEqual(request?.body, {
    mode: 'plan',
    harness: 'codex',
    task: 'standard',
    profile: 'balanced',
    reserve: 20,
    tasksLeft: 5,
  });
  assert.match(browser.get('modal-content').textContent, /Suggested reasoning: medium/);
  assert.equal(browser.applies().length, 0);
});

it('records only the explicit workload and preserves insufficient evidence in the UI', async () => {
  const browser = await startGuidedBrowser({
    respond: (path) =>
      path === '/api/tools'
        ? {
            mode: 'schedule',
            envelope: {
              command: 'schedule',
              exitCode: 0,
              diagnostics: [],
              data: {
                requestedTasks: 3,
                allocatedTasks: 0,
                reasons: [{ summary: 'No matched quality receipts.' }],
              },
            },
          }
        : undefined,
  });
  await browser.turn('details');
  browser.button(browser.get('details-root'), 'Compare coding agents').fire('click');
  browser.get('tool-hard').value = '3';
  browser.button(browser.get('modal-actions'), 'Get advice').fire('click');
  await browser.settle();
  assert.match(browser.get('modal-content').textContent, /More evidence needed/);
  assert.match(browser.get('modal-content').textContent, /No matched quality receipts/);
  assert.deepEqual(browser.writes.find((item) => item.path === '/api/tools')?.body, {
    mode: 'schedule',
    current: 'codex',
    candidate: 'claude',
    workload: { mechanical: 0, standard: 0, hard: 3, critical: 0 },
  });
  assert.equal(browser.applies().length, 0);
});

it('requires a second click on the returned experiment ticket before preparation', async () => {
  const browser = await startGuidedBrowser({
    respond: (path, body) =>
      path === '/api/experiments'
        ? (body as { mode?: string }).mode === 'apply'
          ? { ok: true, summary: 'Prepared and verified.', messages: [] }
          : {
              ok: true,
              ticket: 'reviewed-experiment',
              summary: 'Temporarily change two files.',
              messages: [],
            }
        : undefined,
  });
  await browser.turn('details');
  browser.button(browser.get('details-root'), 'Four-arm comparison').fire('click');
  browser.get('experiment-state').value = 'fixture-v1';
  browser.button(browser.get('modal-actions'), 'Review step').fire('click');
  await browser.settle();
  assert.equal(browser.writes.filter((item) => item.path === '/api/experiments').length, 1);
  assert.match(browser.get('modal-content').textContent, /Temporarily change two files/);
  browser.button(browser.get('modal-actions'), 'Apply reviewed step').fire('click');
  await browser.settle();
  assert.deepEqual(browser.writes.filter((item) => item.path === '/api/experiments')[1]?.body, {
    mode: 'apply',
    ticket: 'reviewed-experiment',
  });
});

it('preparing app removal itself never changes configuration or uninstalls a package', async () => {
  const browser = await startGuidedBrowser();
  await browser.turn('details');
  browser.button(browser.get('details-root'), 'Prepare to remove the app').fire('click');
  assert.match(
    browser.get('modal-content').textContent,
    /manually configured connections stay installed/,
  );
  assert.equal(browser.previews().length, 0);
  assert.equal(browser.applies().length, 0);
});
