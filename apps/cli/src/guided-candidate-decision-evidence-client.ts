/** Supplement the campaign modal with conservative decision evidence; never infer promotion. */
export const GUIDE_CANDIDATE_DECISION_EVIDENCE_JS = String.raw`
'use strict';
(() => {
  const root = document.getElementById('modal-content');
  if (!root) return;

  const campaignPattern = /^(headroom|mcptoon|gitnexus)-(claude|codex)-eval-[a-z0-9]{1,32}$/;
  const inFlight = new Set();
  let queued = false;

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

  const activationLabel = value => ({
    verified: 'Verified',
    blocked: 'Blocked',
    unreviewed: 'Unreviewed',
  })[value] || 'Unreviewed';

  function campaignIdentity(agent) {
    const captions = Array.from(agent.querySelectorAll('p.caption'));
    const caption = captions.find(element => (element.textContent || '').startsWith('Campaign id: '));
    if (!caption) return null;
    const campaignId = (caption.textContent || '').slice('Campaign id: '.length).trim();
    const match = campaignPattern.exec(campaignId);
    if (!match) return null;
    return { campaignId, candidateId: match[1], harnessId: match[2] };
  }

  function statusUrl(identity) {
    return '/api/candidate-campaign?candidate=' + encodeURIComponent(identity.candidateId) +
      '&harness=' + encodeURIComponent(identity.harnessId) +
      '&campaign=' + encodeURIComponent(identity.campaignId);
  }

  function deltaText(value, pairs) {
    if (value === null || value === undefined || Number(pairs) < 1) return 'Not measured';
    const numeric = Number(value);
    const direction = numeric >= 0 ? ' lower' : ' higher';
    return String(Math.abs(numeric)) + '%' + direction + ' across ' + String(pairs) + ' comparable pair(s)';
  }

  function render(agent, statusHost, source, data) {
    const previous = agent.querySelector('.candidate-decision-evidence');
    previous?.remove();

    const block = node('div', undefined, 'candidate-decision-evidence explain-box');
    block.dataset.source = source;
    block.append(
      node('strong', 'Decision evidence'),
      node(
        'p',
        'Benchmark evidence, runtime activation evidence and current local capability are evaluated separately. This is not a composite score or promotion recommendation.',
        'caption',
      ),
    );

    const facts = node('div', undefined, 'tool-facts');
    const coverage = data.evidenceCoveragePercent === null
      ? 'Not measured'
      : String(data.evidenceCoveragePercent) + '%';
    const minimumCoverage = data.minimumEvidenceCoveragePercent === null
      ? 'no threshold'
      : 'minimum ' + String(data.minimumEvidenceCoveragePercent) + '%';
    const classes = Array.isArray(data.coveredTaskClasses) ? data.coveredTaskClasses : [];
    const minimumClasses = data.minimumTaskClasses === null
      ? 'no threshold'
      : String(data.minimumTaskClasses) + ' minimum';
    const readiness = data.promotionReadiness;
    if (readiness) {
      facts.append(
        node('span', 'Promotion review'),
        node(
          'strong',
          String(readiness.passedGateCount) + '/' + String(readiness.requiredGateCount) + ' gates · ' + String(readiness.state),
        ),
        node('span', 'Next gate'),
        node('strong', gateName(readiness.nextGate)),
      );
    }
    facts.append(
      node('span', 'Activation evidence'),
      node('strong', activationLabel(data.activationState)),
      node('span', 'Activation pairs'),
      node(
        'strong',
        String(data.activationVerifiedPairs || 0) + ' verified · ' +
          String(data.activationBlockedPairs || 0) + ' blocked · ' +
          String(data.activationUnknownPairs || 0) + ' unknown',
      ),
      node('span', 'Evidence coverage'),
      node('strong', coverage + ' · ' + minimumCoverage),
      node('span', 'Task classes'),
      node('strong', String(classes.length) + '/' + minimumClasses + (classes.length ? ' · ' + classes.join(', ') : '')),
      node('span', 'Pair verdicts'),
      node('strong', String(data.optimizedBetter) + ' candidate · ' + String(data.baselineBetter) + ' baseline · ' + String(data.equivalent) + ' equivalent'),
      node('span', 'Local token delta'),
      node('strong', deltaText(data.localTokenSavingPercent, data.localComparablePairs)),
      node('span', 'Wall-clock delta'),
      node('strong', deltaText(data.wallClockSavingPercent, data.wallClockComparablePairs)),
    );
    block.append(facts);

    block.append(
      node(
        'p',
        'Activation evidence is independent from selection signal and promotion gates. Local token/context evidence is not provider allowance. Wall-clock is operational evidence, not subscription or API savings. Lifecycle and combined-stack gates remain explicit.',
        'caption',
      ),
    );

    if (Number(data.hardRegressionPairs) > 0) {
      const warning = node('div', undefined, 'explain-box warn');
      warning.append(
        node('strong', 'Quality or reliability regression detected'),
        node('p', String(data.hardRegressionPairs) + ' completed pair(s) triggered a hard regression gate.'),
      );
      block.append(warning);
    }

    if (Array.isArray(data.promotionBlockers) && data.promotionBlockers.length) {
      const blockers = node('div', undefined, 'candidate-promotion-blockers');
      blockers.append(node('strong', 'What still blocks promotion'));
      const list = node('ul');
      for (const blocker of data.promotionBlockers) list.append(node('li', blocker));
      blockers.append(list);
      block.append(blockers);
    }

    statusHost.insertAdjacentElement('afterend', block);
  }

  async function enrich(agent) {
    const identity = campaignIdentity(agent);
    const statusHost = agent.querySelector('.candidate-campaign-status');
    if (!identity || !statusHost || !statusHost.querySelector('.tool-facts')) return;

    const source = statusHost.textContent || '';
    const previous = agent.querySelector('.candidate-decision-evidence');
    if (previous?.dataset.source === source) return;

    const key = identity.campaignId + ':' + source;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      const response = await fetch(statusUrl(identity), { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.available || data.campaignId !== identity.campaignId) return;
      render(agent, statusHost, source, data);
    } catch {
      // Decision evidence is supplementary; the campaign workflow remains authoritative.
    } finally {
      inFlight.delete(key);
    }
  }

  function refresh() {
    queued = false;
    for (const agent of root.querySelectorAll('.candidate-campaign-agent')) void enrich(agent);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(refresh);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  schedule();
})();
`;
