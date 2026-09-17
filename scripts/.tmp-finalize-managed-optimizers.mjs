import fs from 'node:fs';

const statusPath = 'docs/development-status.md';
let status = fs.readFileSync(statusPath, 'utf8');
const heading = '# Development status\n\n';
const entry = `- 2026-09-17: PR #306 promotes **mcptoon 0.7.10, GitNexus 1.6.12 and Headroom 0.37.0** into the ordinary optional managed provider registry while RTK + HarnessTrim remain the production baseline. mcptoon may install only through an already-present pipx and owns only reviewed Claude/Codex guidance; Token Harness never bootstraps Python, pipx or administrator prerequisites. GitNexus manages only the exact reviewed Claude MCP entry, never installs/indexes the package, and keeps its PolyForm Noncommercial boundary visible. Headroom manages the official local \`headroom mcp serve\` registration for the default Claude Code 2.x \`~/.claude.json\` and Codex \`~/.codex/config.toml\` paths; its Apache-2.0 package install remains a pinned manual prerequisite through an existing uv + Python 3.13 because uv package absence-restoration is not yet a reviewed transaction path. All three managed configuration lifecycles use exact-version/config-only admission, ownership-aware removal and drift refusal. No Headroom wrap/proxy/deploy, GitNexus indexing, model call or new RTK/HarnessTrim evidence campaign is part of this PR.\nCurrent focus: finish the complete Ubuntu/macOS/Windows PR CI (tests, Windows RTK live smoke, build, bundle/package and installed-package smoke), merge only when every job is green, then verify post-merge \`main\` CI.\n\n`;
if (!status.startsWith(heading)) throw new Error('development status heading not found');
if (!status.includes('2026-09-17: PR #306 promotes')) {
  status = heading + entry + status.slice(heading.length);
  fs.writeFileSync(statusPath, status);
}

const clientPath = 'apps/cli/src/guided-product-client.ts';
let client = fs.readFileSync(clientPath, 'utf8');
const oldBlock = `    if (component?.health === 'attention' && component.warnings?.length)\n      card.append(messageBox('Needs attention', component.warnings[0].message, 'warn'));\n    return card;`;
const newBlock = `    if (component?.warnings?.length) {\n      const attention = component.health === 'attention';\n      const prerequisite = !component.installed && component.nextAction?.kind === 'install-configure';\n      if (attention || prerequisite)\n        card.append(\n          messageBox(\n            attention ? 'Needs attention' : 'Prerequisite needed',\n            component.warnings[0].message,\n            attention ? 'warn' : '',\n          ),\n        );\n    }\n    return card;`;
if (!client.includes(oldBlock)) throw new Error('managed warning block not found');
client = client.replace(oldBlock, newBlock);
fs.writeFileSync(clientPath, client);
