/** Prevents the shared dialog from being dismissed while a reviewed mutation is applying. */
export const GUIDE_MODAL_GUARD_JS = String.raw`
'use strict';
(() => {
  const modal = document.getElementById('modal');
  if (!modal) return;
  modal.addEventListener('cancel', event => {
    const applying = [...modal.querySelectorAll('button:disabled')].some(button =>
      /Applying/.test(button.textContent || ''),
    );
    if (!applying) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
`;
