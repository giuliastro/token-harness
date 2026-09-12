/** Read-only combined-stack review presentation layered over the novice Setup UI. */
export const GUIDE_STACK_COMBINATION_JS = String.raw`
'use strict';
(() => {
  const host = document.getElementById('managed-setup-actions');
  if (!host) return;

  const originalFetch = window.fetch.bind(window);
  const names = { rtk: 'RTK', harnesstrim: 'HarnessTrim' };

  function remove() {
    document.querySelector('.stack-combination-review')?.remove();
  }

  function render(stack) {
    const review = stack?.combinationReview;
    if (!review || review.state === 'not-applicable') {
      remove();
      return;
    }

    remove();
    const block = document.createElement('div');
    block.className = 'managed-action-box stack-combination-review';
    block.dataset.state = review.state;

    const title = document.createElement('strong');
    const providers = Array.isArray(review.providerIds)
      ? review.providerIds.map(id => names[id] || id).join(' + ')
      : 'Managed stack';
    const message = document.createElement('p');
    message.className = 'caption';

    if (review.state === 'reviewed') {
      title.textContent = 'Combined stack reviewed';
      message.textContent = providers + ' has explicit exact-set review evidence. Individual verification remains visible separately.';
    } else if (review.state === 'incompatible') {
      title.textContent = 'Combined stack needs attention';
      message.textContent = providers + ' has explicit evidence that this exact combination is incompatible. Token Harness does not hide that behind healthy individual checks.';
    } else {
      title.textContent = 'Combined review not recorded';
      message.textContent = providers + ' may be individually compatible and verified, but that does not prove they were reviewed together. The stack stays incomplete until exact combined evidence exists.';
    }

    block.append(title, message);
    if (review.detail) {
      const detail = document.createElement('p');
      detail.className = 'caption';
      detail.textContent = review.detail;
      block.append(detail);
    }
    host.insertAdjacentElement('afterend', block);
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const target = String(args[0]);
      if (
        response.ok &&
        (target.includes('/api/overview') ||
          target.includes('/api/verify') ||
          target.includes('/api/update-check'))
      ) {
        const data = await response.clone().json();
        if (data?.stack) render(data.stack);
      }
    } catch {
      // Combined review is supplementary UI; never interfere with the authoritative request.
    }
    return response;
  };
})();
`;
