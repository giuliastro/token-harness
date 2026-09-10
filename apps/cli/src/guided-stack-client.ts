/** Small browser projection for RFC 0027's primary product object. */
export const GUIDE_STACK_JS = String.raw`
'use strict';
(() => {
  const originalFetch = window.fetch.bind(window);
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const count = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  const category = {
    'command-output-reduction': 'Shell / tool output',
    'context-minimization': 'Context minimization',
    'repository-retrieval': 'Repository exploration',
    'mcp-discovery': 'MCP schema / discovery',
    'result-compression': 'Tool result payload',
    'native-policy': 'Native model / reasoning',
    other: 'Other',
  };
  const verification = {
    'not-checked': 'Not checked',
    verified: 'Verified',
    degraded: 'Degraded',
    'not-exercised': 'Not exercised yet',
    'not-applicable': 'Not applicable',
  };
  const update = {
    'not-checked': 'Not checked',
    current: 'Up to date',
    available: 'Update available',
    blocked: 'Compatibility review needed',
    pinned: 'Pinned',
    unknown: 'Unknown',
    unavailable: 'Unavailable',
    'not-installed': 'Not installed',
    'no-channel': 'No update channel',
  };
  const measurement = {
    'exact-local': 'Measured local output',
    'estimated-local': 'Local estimate',
    'end-to-end-billed': 'Paired session measurement',
  };

  function proxyButton(sourceId, label, cls = 'secondary') {
    const button = node('button', label, cls);
    button.type = 'button';
    button.addEventListener('click', () => $(sourceId)?.click());
    return button;
  }

  function action(component) {
    const next = component.nextAction;
    if (!next) return null;
    if (next.kind === 'install-configure' || next.kind === 'configure')
      return proxyButton('setup', 'Review setup');
    if (next.kind === 'verify') return proxyButton('verify', 'Check integrations');
    if (next.kind === 'measure') return proxyButton('measurement-help', 'Measurement help');
    if (next.kind === 'review-health') return proxyButton('tab-activity', 'Review health evidence');
    return null;
  }

  function renderComponent(component) {
    const card = node('article', undefined, 'panel agent');
    const head = node('div', undefined, 'agent-head');
    const title = node('div');
    title.append(
      node('h2', component.displayName),
      node('span', category[component.category] || component.category, 'caption'),
    );
    const healthLabel =
      component.health === 'healthy'
        ? 'Healthy'
        : component.health === 'attention'
          ? 'Needs attention'
          : 'Not fully verified';
    head.append(
      title,
      node(
        'span',
        healthLabel,
        'pill ' + (component.health === 'healthy' ? 'good' : component.health === 'attention' ? 'warn' : ''),
      ),
    );
    card.append(head);

    const lifecycle = node('div', undefined, 'agent-line');
    lifecycle.append(
      node('span', 'Lifecycle', 'key'),
      node(
        'strong',
        component.configured
          ? 'Configured'
          : component.installed
            ? 'Installed, not configured'
            : 'Available',
      ),
    );
    card.append(lifecycle);

    const version = node('div', undefined, 'agent-line');
    version.append(
      node('span', 'Version', 'key'),
      node('strong', component.version ? 'v' + component.version : 'Unavailable'),
    );
    card.append(version);

    const check = node('div', undefined, 'agent-line');
    check.append(
      node('span', 'Verification', 'key'),
      node('strong', verification[component.verification] || component.verification),
    );
    card.append(check);

    const updateLine = node('div', undefined, 'agent-line');
    const updateLabel = update[component.update] || component.update;
    updateLine.append(
      node('span', 'Update', 'key'),
      node(
        'strong',
        component.updateAvailableVersion
          ? updateLabel + ' · v' + component.updateAvailableVersion
          : updateLabel,
      ),
    );
    card.append(updateLine);

    const savings = (component.savings || []).filter(row => row.class !== 'counterfactual');
    if (savings.length) {
      for (const row of savings) {
        const saving = node('div', undefined, 'allowance-strip');
        saving.append(
          node('span', measurement[row.class] || row.class, 'key'),
          node(
            'strong',
            row.saved >= 0
              ? count(row.saved) + ' ' + row.unit + ' saved'
              : count(Math.abs(row.saved)) + ' ' + row.unit + ' more',
          ),
          node(
            'span',
            count(row.operations) + ' operation' + (row.operations === 1 ? '' : 's'),
            'caption',
          ),
        );
        card.append(saving);
      }
    } else {
      const saving = node('div', undefined, 'allowance-strip');
      saving.append(
        node('span', 'Measured value', 'key'),
        node('strong', 'No attributable result yet'),
      );
      card.append(saving);
    }

    const quality = node('div', undefined, 'agent-line');
    const qualityLabel =
      component.quality.state === 'preserved'
        ? 'Preserved'
        : component.quality.state === 'regressed'
          ? 'Regression detected'
          : component.quality.state === 'not-measured'
            ? 'Not measured'
            : 'Not attributed';
    quality.append(node('span', 'Quality', 'key'), node('strong', qualityLabel));
    card.append(quality);

    const details = node('details', undefined, 'agent-details');
    details.append(node('summary', 'Evidence and lifecycle details'));
    details.append(node('p', component.quality.detail, 'caption'));
    if (component.update === 'not-checked')
      details.append(
        node(
          'p',
          'No provider network update check runs automatically when the dashboard opens.',
          'caption',
        ),
      );
    for (const conflict of component.conflicts || [])
      details.append(node('p', 'Conflict: ' + conflict.detail, 'caption'));
    for (const warning of component.warnings || [])
      details.append(node('p', warning.message, 'caption'));
    if (component.nextAction)
      details.append(node('p', 'Next: ' + component.nextAction.reason, 'caption'));
    card.append(details);

    const next = action(component);
    if (next) {
      const actions = node('div', undefined, 'inline-actions');
      actions.append(next);
      card.append(actions);
    }
    return card;
  }

  function renderStack(stack) {
    const root = $('stack');
    if (!root || !stack) return;
    root.replaceChildren();
    root.setAttribute('aria-busy', 'false');
    const components = (stack.components || []).filter(
      component => component.detectedState !== 'absent',
    );
    if (!components.length) {
      root.append(
        node(
          'p',
          'No optimization component is currently installed or configured. Review setup to see supported changes.',
          'empty',
        ),
      );
      return;
    }
    for (const component of components) root.append(renderComponent(component));
    if (stack.unattributedDrift?.length) {
      const drift = node('article', undefined, 'panel agent');
      drift.append(
        node('h2', 'Unattributed configuration drift'),
        node('p', stack.unattributedDrift[0].detail),
        proxyButton('tab-activity', 'Review evidence'),
      );
      root.append(drift);
    }
  }

  window.fetch = async (...args) => {
    let fetchArgs = args;
    const target = String(args[0]);
    if (target.includes('/api/verify') && args[1] && typeof args[1] === 'object') {
      try {
        const options = { ...args[1] };
        if (typeof options.body === 'string') {
          const body = JSON.parse(options.body);
          const period = $('period')?.value;
          if (
            body &&
            typeof body === 'object' &&
            !Array.isArray(body) &&
            body.period === undefined &&
            ['all', '7d', '30d'].includes(period)
          ) {
            options.body = JSON.stringify({ ...body, period });
            fetchArgs = [args[0], options];
          }
        }
      } catch {
        // Keep the original request unchanged if it is not the guided JSON shape.
      }
    }
    const response = await originalFetch(...fetchArgs);
    try {
      if (response.ok && (target.includes('/api/overview') || target.includes('/api/verify'))) {
        const data = await response.clone().json();
        if (data?.stack) renderStack(data.stack);
      }
    } catch {
      // Stack rendering is supplementary. Never interfere with the existing dashboard request.
    }
    return response;
  };
})();
`;
