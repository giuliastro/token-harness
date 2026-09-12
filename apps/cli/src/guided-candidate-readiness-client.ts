import { GUIDE_CANDIDATE_COMPARISON_JS } from './guided-candidate-comparison-client.js';
import { GUIDE_CANDIDATE_DECISION_EVIDENCE_JS } from './guided-candidate-decision-evidence-client.js';
import { GUIDE_STACK_COMBINATION_JS } from './guided-stack-combination-client.js';

/** Candidate promotion-readiness presentation layered over the guided product UI. */
const GUIDE_CANDIDATE_READINESS_BASE_JS = String.raw`
'use strict';
(() => {
  const root = document.getElementById('experimental-tools');
  const period = document.getElementById('period');
  if (!root || !period) return;

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

  let queued = false;
  let observer;

  function observe() {
    observer.observe(root, { childList: true, subtree: true });
  }

  function apply(items, generatedAt) {
    const byName = new Map(items.map(item => [item.displayName, item]));
    observer.disconnect();
    try {
      if (!root.querySelector('.candidate-comparison-toolbar')) {
        const firstCard = root.querySelector('article.tool-card.experimental');
        if (firstCard) {
          const toolbar = document.createElement('div');
          toolbar.className = 'candidate-comparison-toolbar inline-actions';
          const compare = document.createElement('button');
          compare.type = 'button';
          compare.id = 'candidate-compare-evidence';
          compare.className = 'secondary';
          compare.dataset.action = 'candidate-comparison';
          compare.textContent = 'Compare evaluation evidence';
          compare.title = 'Compare saved campaigns only; no new environment scan is started.';
          toolbar.append(compare);
          root.insertBefore(toolbar, firstCard);
        }
      }

      for (const card of root.querySelectorAll('article.tool-card.experimental')) {
        const name = card.querySelector('h3')?.textContent || '';
        const item = byName.get(name);
        const readiness = item?.promotionReadiness;
        if (!readiness) continue;
        const previous = card.querySelector('.candidate-readiness');
        if (previous?.dataset.generatedAt === generatedAt) continue;
        previous?.remove();

        const block = document.createElement('div');
        block.className = 'candidate-readiness';
        block.dataset.generatedAt = generatedAt;
        const facts = document.createElement('div');
        facts.className = 'tool-facts';
        const gateLabel = document.createElement('span');
        gateLabel.textContent = 'Promotion review';
        const gateValue = document.createElement('strong');
        gateValue.textContent = String(readiness.passedGateCount) + '/' + String(readiness.requiredGateCount) + ' gates';
        const nextLabel = document.createElement('span');
        nextLabel.textContent = 'Next gate';
        const nextValue = document.createElement('strong');
        nextValue.textContent = gateName(readiness.nextGate);
        facts.append(gateLabel, gateValue, nextLabel, nextValue);

        const note = document.createElement('p');
        note.className = 'caption candidate-readiness-note';
        note.textContent = readiness.promotionEligible
          ? 'All reviewed promotion gates are satisfied.'
          : 'Evaluation readiness is not promotion approval. Remaining lifecycle gates stay explicit.';
        block.append(facts, note);
        const actions = card.querySelector('.inline-actions');
        if (actions) card.insertBefore(block, actions);
        else card.append(block);
      }
    } finally {
      observe();
    }
  }

  async function refreshReadiness() {
    queued = false;
    const heading = root.querySelector('article.tool-card.experimental h3');
    if (!heading || heading.textContent === 'Checking experimental tools…') return;
    try {
      const response = await fetch('/api/overview?period=' + encodeURIComponent(period.value), { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      apply(data.optimizationCandidates || [], data.generatedAt || 'unknown');
    } catch {
      // Promotion readiness is supplementary; the main dashboard remains authoritative.
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(refreshReadiness);
  }

  observer = new MutationObserver(schedule);
  observe();
  schedule();
})();
`;

export const GUIDE_CANDIDATE_READINESS_JS = `${GUIDE_CANDIDATE_READINESS_BASE_JS}\n${GUIDE_CANDIDATE_COMPARISON_JS}\n${GUIDE_CANDIDATE_DECISION_EVIDENCE_JS}\n${GUIDE_STACK_COMBINATION_JS}`;
