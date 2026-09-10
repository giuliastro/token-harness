import { GUIDE_JS as SIMPLE_GUIDE_JS } from './guided-simple-client.js';

/**
 * Keep the main controller readable while overriding the result renderer with the
 * non-resetting form used by the new operation state machine. This runs before
 * any user interaction because both strings are served as one script payload.
 */
export const GUIDE_JS =
  SIMPLE_GUIDE_JS +
  String.raw`
renderResult = function(result) {
  $('review-title').textContent = result.ok ? 'Done' : 'Needs attention';
  $('review-content').replaceChildren();
  $('review-error').hidden = true;
  $('task-form').hidden = true;
  $('task-review').hidden = true;
  $('approve').hidden = true;
  const state = node('div', result.ok ? 'Completed' : 'Needs attention', 'result-state ' + (result.ok ? 'good' : 'warn'));
  $('review-content').append(state);
  for (const message of result.messages || []) $('review-content').append(node('p', message));
  $('close').disabled = false;
  $('close').textContent = 'Done';
  return dialogRun;
};
`;
