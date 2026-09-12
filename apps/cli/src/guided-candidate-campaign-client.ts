/** Replace the ad-hoc candidate evaluation modal with the standardized resumable campaign flow. */
export const GUIDE_CANDIDATE_CAMPAIGN_JS = String.raw`
'use strict';
(() => {
  const root = document.getElementById('experimental-tools');
  const dialog = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');
  const actions = document.getElementById('modal-actions');
  const error = document.getElementById('modal-error');
  if (!root || !dialog || !title || !content || !actions || !error) return;

  const candidates = new Map([
    ['Headroom', { id: 'headroom', name: 'Headroom' }],
    ['mcptoon', { id: 'mcptoon', name: 'mcptoon' }],
    ['GitNexus', { id: 'gitnexus', name: 'GitNexus' }],
  ]);

  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };

  function button(label, handler, cls = 'secondary') {
    const element = node('button', label, cls);
    element.type = 'button';
    element.addEventListener('click', handler);
    return element;
  }

  function messageBox(heading, text, cls = '') {
    const box = node('div', undefined, 'explain-box ' + cls);
    box.append(node('strong', heading), node('p', text));
    return box;
  }

  function copyRow(command) {
    const block = node('div', undefined, 'command-block');
    const code = node('code', command);
    const copy = button('Copy', async () => {
      try {
        await navigator.clipboard.writeText(command);
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      } catch {
        copy.textContent = 'Select command';
      }
    });
    block.append(code, copy);
    return block;
  }

  function detectedHarnesses() {
    const names = Array.from(document.querySelectorAll('#setup-agents article.tool-card h3'))
      .map(element => element.textContent || '');
    const harnesses = [];
    if (names.includes('Claude Code')) harnesses.push('claude');
    if (names.includes('Codex')) harnesses.push('codex');
    return harnesses;
  }

  function newCampaignId(candidateId, harness) {
    return candidateId + '-' + harness + '-eval-' + Date.now().toString(36);
  }

  function campaignId(candidateId, harness, fresh = false) {
    const key = 'token-harness:candidate-campaign:' + candidateId + ':' + harness;
    if (!fresh) {
      try {
        const saved = localStorage.getItem(key);
        if (saved) return saved;
      } catch {
        // Browser storage is optional; a generated id still gives a valid resumable campaign.
      }
    }
    const value = newCampaignId(candidateId, harness);
    try { localStorage.setItem(key, value); } catch { /* optional */ }
    return value;
  }

  function signalLabel(signal) {
    return ({
      'insufficient-evidence': 'More evidence needed',
      promising: 'Promising',
      mixed: 'Mixed',
      negative: 'Negative',
      unavailable: 'Unavailable',
    })[signal] || String(signal || 'Unavailable');
  }

  function statusUrl(candidateId, harness, campaign) {
    return '/api/candidate-campaign?candidate=' + encodeURIComponent(candidateId) +
      '&harness=' + encodeURIComponent(harness) +
      '&campaign=' + encodeURIComponent(campaign);
  }

  function terminalStatusCommand(candidateId, harness, campaign) {
    return 'token-harness benchmark-matrix --benchmark-id ' + campaign +
      ' --candidate ' + candidateId + ' --harness ' + harness;
  }

  async function renderCampaignStatus(candidate, harness, campaign, host) {
    host.replaceChildren(node('p', 'Reading campaign progress…', 'caption'));
    try {
      const response = await fetch(statusUrl(candidate.id, harness, campaign), {
        cache: 'no-store',
        signal: AbortSignal.timeout(120000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Campaign status is unavailable.');

      host.replaceChildren();
      if (!data.available) {
        host.append(
          messageBox(
            'Campaign status unavailable',
            data.nextInstruction || 'Campaign evidence could not be read. Nothing was changed.',
            'warn',
          ),
          button('Try again', () => renderCampaignStatus(candidate, harness, campaign, host)),
        );
        return;
      }

      const facts = node('div', undefined, 'tool-facts');
      facts.append(
        node('span', 'Progress'),
        node('strong', String(data.completedPairs) + '/' + String(data.totalPairs) + ' pairs · ' + String(data.progressPercent) + '%'),
        node('span', 'Selection signal'),
        node('strong', signalLabel(data.signal)),
        node('span', 'Decision ready'),
        node('strong', data.decisionReady ? 'Yes' : 'No'),
        node('span', 'Evidence pairs'),
        node('strong', String(data.evidencePairs)),
      );
      host.append(facts);

      if (data.invalidPairs > 0) {
        host.append(
          messageBox(
            'Campaign needs attention',
            String(data.invalidPairs) + ' pair(s) contain ambiguous or incompatible state. Start a new campaign instead of repairing evidence in place.',
            'warn',
          ),
        );
      }

      host.append(
        messageBox(
          data.nextCommand ? 'Next' : 'Campaign assessment',
          data.nextInstruction || 'No further campaign step was reported.',
          data.invalidPairs > 0 ? 'warn' : '',
        ),
      );
      if (data.nextCommand) host.append(copyRow(data.nextCommand));

      if (Array.isArray(data.reasons) && data.reasons.length) {
        const reasons = node('div', undefined, 'explain-box');
        reasons.append(node('strong', 'Why this signal'));
        const list = node('ul');
        for (const reason of data.reasons) list.append(node('li', reason));
        reasons.append(list);
        host.append(reasons);
      }

      host.append(
        node(
          'p',
          data.note || 'Selection evidence does not prove activation or promotion readiness.',
          'caption',
        ),
        button('Refresh status', () => renderCampaignStatus(candidate, harness, campaign, host)),
      );
    } catch {
      host.replaceChildren(
        messageBox(
          'Campaign status could not be read',
          'No automatic retry or candidate activation was attempted. You can retry here or use the terminal fallback below.',
          'warn',
        ),
        button('Try again', () => renderCampaignStatus(candidate, harness, campaign, host)),
      );
    }
  }

  function openCampaign(candidate, fresh = false) {
    const harnesses = detectedHarnesses();
    title.textContent = 'Evaluate ' + candidate.name + ' with a standard campaign';
    content.replaceChildren();
    actions.replaceChildren();
    error.hidden = true;
    error.textContent = '';

    content.append(
      messageBox(
        'Standard comparison, not a quick one-off',
        'Token Harness uses a resumable paired campaign across task classes so selection evidence can become decision-ready without turning one good run into a recommendation.',
      ),
      messageBox(
        'Activation remains yours',
        'For every optimized run, enable ' + candidate.name + ' through its own documented workflow first. Candidate attribution records the experiment target; it does not prove the candidate was active.',
        'warn',
      ),
    );

    if (!harnesses.length) {
      content.append(
        messageBox(
          'Coding agent needed',
          'Token Harness did not detect Claude Code or Codex in this dashboard. Start the app from an environment where one is available, choose Refresh, then return here.',
          'warn',
        ),
      );
    } else {
      content.append(
        node('h3', 'Campaign status'),
        node(
          'p',
          'Choose the agent you are evaluating. Each agent has its own resumable campaign. Progress, assessment and the exact Next step are read here without a separate status command.',
          'caption',
        ),
      );
      for (const harness of harnesses) {
        const label = harness === 'claude' ? 'Claude Code' : 'Codex';
        const id = campaignId(candidate.id, harness, fresh);
        const agentBlock = node('div', undefined, 'candidate-campaign-agent');
        const liveStatus = node('div', undefined, 'candidate-campaign-status');
        const fallback = document.createElement('details');
        fallback.append(
          node('summary', 'Terminal fallback'),
          node(
            'p',
            'The browser status above is read-only. This command shows the same campaign assessment in a terminal if you need it for debugging or automation.',
            'caption',
          ),
          copyRow(terminalStatusCommand(candidate.id, harness, id)),
        );
        agentBlock.append(
          node('strong', label),
          node('p', 'Campaign id: ' + id, 'caption'),
          liveStatus,
          fallback,
        );
        content.append(agentBlock);
        void renderCampaignStatus(candidate, harness, id, liveStatus);
      }
      content.append(
        node('h3', 'How the campaign advances'),
        node(
          'p',
          'Complete the baseline or optimized task honestly, then use Refresh status. Token Harness advances one state at a time and stops on ambiguous evidence instead of overwriting it.',
        ),
        node('h3', 'How to read the assessment'),
        node(
          'p',
          'The campaign reports insufficient-evidence, promising, mixed or negative plus whether the evidence is decision-ready. Even a promising decision-ready result is still not promotion approval; activation, lifecycle, compatibility and combined-stack gates remain separate.',
        ),
      );
    }

    actions.append(
      button('New campaign ids', () => openCampaign(candidate, true)),
      button('Done', () => dialog.close()),
    );
    if (!dialog.open) dialog.showModal();
  }

  function tagButtons() {
    for (const card of root.querySelectorAll('article.tool-card.experimental')) {
      const candidate = candidates.get(card.querySelector('h3')?.textContent || '');
      if (!candidate) continue;
      for (const candidateButton of card.querySelectorAll('.inline-actions button')) {
        if (candidateButton.dataset.candidateCampaign === candidate.id) continue;
        if (candidateButton.textContent !== 'How to evaluate') continue;
        candidateButton.dataset.candidateCampaign = candidate.id;
        candidateButton.textContent = 'Run standard evaluation';
      }
    }
  }

  root.addEventListener('click', event => {
    const target = event.target instanceof Element
      ? event.target.closest('button[data-candidate-campaign]')
      : null;
    if (!target) return;
    const candidate = Array.from(candidates.values()).find(
      item => item.id === target.dataset.candidateCampaign,
    );
    if (!candidate) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCampaign(candidate);
  }, true);

  new MutationObserver(tagButtons).observe(root, { childList: true, subtree: true });
  tagButtons();
})();
`;
