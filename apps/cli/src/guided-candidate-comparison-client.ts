/** On-demand comparison of already-existing candidate campaigns; never creates or ranks evidence. */
export const GUIDE_CANDIDATE_COMPARISON_JS = String.raw`
'use strict';
(() => {
  const root = document.getElementById('experimental-tools');
  const dialog = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');
  const actions = document.getElementById('modal-actions');
  const error = document.getElementById('modal-error');
  if (!root || !dialog || !title || !content || !actions || !error) return;

  const candidates = [
    { id: 'headroom', name: 'Headroom' },
    { id: 'mcptoon', name: 'mcptoon' },
    { id: 'gitnexus', name: 'GitNexus' },
  ];
  const harnesses = [
    { id: 'claude', name: 'Claude Code' },
    { id: 'codex', name: 'Codex' },
  ];
  const campaignSuffix = /^[a-z0-9]{1,32}$/;

  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };

  const gateName = value => ({
    'benchmark-capability': 'benchmark capability',
    'category-fit': 'category fit',
    'selection-evidence': 'selection evidence',
    'activation-verification': 'activation verification',
    'managed-lifecycle': 'managed lifecycle',
    'compatibility-reversibility': 'compatibility and rollback',
    'project-maturity': 'project maturity',
    'combined-stack-validation': 'combined stack validation',
    'context-owner-admission': 'context-owner admission',
  })[value] || value || 'none';

  const signalLabel = value => ({
    'insufficient-evidence': 'More evidence needed',
    promising: 'Promising',
    mixed: 'Mixed',
    negative: 'Negative',
    unavailable: 'Unavailable',
  })[value] || String(value || 'Unavailable');

  function savedCampaignId(candidateId, harnessId) {
    const key = 'token-harness:candidate-campaign:' + candidateId + ':' + harnessId;
    try {
      const value = localStorage.getItem(key);
      if (!value) return null;
      const prefix = candidateId + '-' + harnessId + '-eval-';
      if (!value.startsWith(prefix)) return null;
      return campaignSuffix.test(value.slice(prefix.length)) ? value : null;
    } catch {
      return null;
    }
  }

  function statusUrl(candidateId, harnessId, campaignId) {
    return '/api/candidate-campaign?candidate=' + encodeURIComponent(candidateId) +
      '&harness=' + encodeURIComponent(harnessId) +
      '&campaign=' + encodeURIComponent(campaignId);
  }

  function messageBox(heading, text, cls = '') {
    const box = node('div', undefined, 'explain-box ' + cls);
    box.append(node('strong', heading), node('p', text));
    return box;
  }

  function closeButton() {
    const button = node('button', 'Close', 'secondary');
    button.type = 'button';
    button.addEventListener('click', () => dialog.close());
    return button;
  }

  function campaignEntries() {
    const entries = [];
    for (const candidate of candidates) {
      for (const harness of harnesses) {
        const campaignId = savedCampaignId(candidate.id, harness.id);
        if (campaignId) entries.push({ candidate, harness, campaignId });
      }
    }
    return entries;
  }

  function renderStatus(row, entry, data) {
    row.replaceChildren();
    row.append(node('strong', entry.candidate.name + ' · ' + entry.harness.name));
    if (!data?.available) {
      row.append(
        node(
          'p',
          'Saved campaign evidence is currently unavailable. Nothing was changed and no replacement campaign was created.',
          'caption',
        ),
      );
      return;
    }

    const readiness = data.promotionReadiness;
    const facts = node('div', undefined, 'tool-facts');
    facts.append(
      node('span', 'Progress'),
      node('strong', String(data.completedPairs) + '/' + String(data.totalPairs) + ' pairs · ' + String(data.progressPercent) + '%'),
      node('span', 'Selection signal'),
      node('strong', signalLabel(data.signal)),
      node('span', 'Decision ready'),
      node('strong', data.decisionReady ? 'Yes' : 'No'),
      node('span', 'Promotion review'),
      node(
        'strong',
        readiness
          ? String(readiness.passedGateCount) + '/' + String(readiness.requiredGateCount) + ' gates'
          : 'Not available',
      ),
      node('span', 'Next gate'),
      node('strong', readiness ? gateName(readiness.nextGate) : 'not reviewed'),
    );
    row.append(
      facts,
      node(
        'p',
        'This row reports evidence for one candidate/harness campaign. Gate counts are not a score or a ranking.',
        'caption',
      ),
    );
  }

  async function openComparison() {
    title.textContent = 'Compare candidate evidence';
    content.replaceChildren();
    actions.replaceChildren(closeButton());
    error.hidden = true;
    error.textContent = '';
    if (!dialog.open) dialog.showModal();

    content.append(
      messageBox(
        'Saved campaigns only',
        'Token Harness reads only evaluation campaigns you already started. Opening this comparison does not create a campaign, install or activate a candidate, or run another environment scan.',
      ),
      messageBox(
        'Evidence, not a leaderboard',
        'Candidates stay in a fixed order. Compare progress, selection evidence and independent promotion gates; no composite score or automatic winner is produced.',
      ),
    );

    const entries = campaignEntries();
    if (!entries.length) {
      content.append(
        messageBox(
          'No saved evaluation campaigns yet',
          'Open a candidate and choose Run standard evaluation first. A comparison appears only after a candidate/harness campaign already exists.',
          'warn',
        ),
      );
      return;
    }

    const list = node('div', undefined, 'candidate-comparison-list');
    content.append(list);
    for (const entry of entries) {
      const row = node('article', undefined, 'candidate-comparison-row explain-box');
      row.append(
        node('strong', entry.candidate.name + ' · ' + entry.harness.name),
        node('p', 'Reading saved campaign…', 'caption'),
      );
      list.append(row);
      try {
        const response = await fetch(
          statusUrl(entry.candidate.id, entry.harness.id, entry.campaignId),
          { cache: 'no-store', signal: AbortSignal.timeout(120000) },
        );
        const data = await response.json();
        renderStatus(row, entry, response.ok ? data : null);
      } catch {
        renderStatus(row, entry, null);
      }
    }
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('#candidate-compare-evidence') : null;
    if (!target) return;
    event.preventDefault();
    void openComparison();
  });
})();
`;
