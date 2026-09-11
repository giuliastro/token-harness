/** Progressive feedback and read-only request shaping for the guided UI. */
export const GUIDE_PROGRESS_JS = String.raw`
(() => {
  const PROGRESS_POLL_MS = 500;
  const originalFetch = window.fetch.bind(window);
  const originalRequest = request;
  const spinner = document.getElementById('reading-spinner');
  let progressTimer = null;

  request = (path, body) => {
    const periodOnly =
      body === undefined &&
      periodReading &&
      path.startsWith('/api/overview?period=') &&
      !path.includes('refresh=1');
    return originalRequest(periodOnly ? path.replace('/api/overview?', '/api/savings?') : path, body);
  };

  function lowerFirst(value) {
    return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
  }

  function loadingMessage(loading) {
    if (!loading?.running || !Array.isArray(loading.stages) || !loading.stages.length) return null;
    const waiting = loading.stages.filter(stage => stage.state === 'working');
    const finished = loading.stages.length - waiting.length;
    const prefix = finished + '/' + loading.stages.length + ' checks finished';
    if (!waiting.length) return prefix + ' · Preparing results…';
    const visible = waiting.slice(0, 2).map(stage => lowerFirst(stage.label));
    const more = waiting.length > visible.length ? ' +' + (waiting.length - visible.length) + ' more' : '';
    return prefix + ' · Still ' + visible.join(' · ') + more;
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const target = String(args[0]);
    if (response.ok && target.includes('/api/activity')) {
      response.clone().json().then(data => {
        const message = loadingMessage(data?.loading);
        const status = document.getElementById('updated');
        if (message && status && spinner && !spinner.hidden) status.textContent = message;
      }).catch(() => undefined);
    }
    return response;
  };

  function pollProgress() {
    if (!document.hidden && typeof activity === 'function') activity();
  }

  function syncProgressPolling() {
    const shouldPoll = Boolean(spinner && !spinner.hidden && !document.hidden);
    if (shouldPoll && progressTimer === null) {
      pollProgress();
      progressTimer = setInterval(pollProgress, PROGRESS_POLL_MS);
      return;
    }
    if (!shouldPoll && progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  if (spinner) {
    new MutationObserver(syncProgressPolling).observe(spinner, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
  }
  document.addEventListener('visibilitychange', syncProgressPolling);
  syncProgressPolling();
})();
`;
