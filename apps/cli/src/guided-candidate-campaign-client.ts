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
        node('h3', '1. Check campaign status'),
        node(
          'p',
          'Choose the agent you are evaluating. Each agent gets its own resumable campaign id so evidence from Claude Code and Codex can never be mixed accidentally.',
          'caption',
        ),
      );
      for (const harness of harnesses) {
        const label = harness === 'claude' ? 'Claude Code' : 'Codex';
        const id = campaignId(candidate.id, harness, fresh);
        const agentBlock = node('div', undefined, 'candidate-campaign-agent');
        agentBlock.append(
          node('strong', label),
          node('p', 'Campaign id: ' + id, 'caption'),
          copyRow(
            'token-harness benchmark-matrix --benchmark-id ' + id +
            ' --candidate ' + candidate.id + ' --harness ' + harness,
          ),
        );
        content.append(agentBlock);
      }
      content.append(
        node('h3', '2. Follow only the reported Next command'),
        node(
          'p',
          'Complete the baseline or optimized task honestly, then rerun the same campaign status command. Token Harness advances one state at a time and stops on ambiguous evidence instead of overwriting it.',
        ),
        node('h3', '3. Read the selection assessment'),
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
