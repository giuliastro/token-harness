import fs from 'node:fs';

// Remove only the fragile README replaceOnce call; keep the PLAN append in the main finalizer.
const patcherPath='.tmp-guidance-state-ui.mjs';
let patcher=fs.readFileSync(patcherPath,'utf8');
const comment='// README + PLAN: keep the human workflow explicit and mark the release candidate UX milestone.\n';
const section=patcher.indexOf(comment);
if(section<0)throw new Error('README/PLAN section not found');
const replaceStart=patcher.indexOf("replaceOnce(\n  'README.md',",section);
const planStart=patcher.indexOf("fs.appendFileSync(\n  'PLAN.md',",replaceStart);
if(replaceStart<0||planStart<=replaceStart)throw new Error('README replacement boundaries not found');
patcher=patcher.slice(0,replaceStart)+patcher.slice(planStart);
fs.writeFileSync(patcherPath,patcher);

const readmePath='README.md';
let readme=fs.readFileSync(readmePath,'utf8');
const before=`The guided app can now preview **Enable in-session guidance** for each detected Claude Code or
Codex installation. It installs the same portable skill into the agent's documented user-level
Agent Skills directory through the normal transactional plan/apply path. Existing \`token-harness
skill directories are left user-owned and are never overwritten or silently adopted. The browser
remains fully usable without any skill or second AI subscription. See
[RFC 0023](docs/rfcs/0023-guided-agent-skill-install.md) for the install and ownership boundary.
`;
const after=`The guided app can preview **Enable in-session guidance** for each detected Claude Code or
Codex installation. It installs the same portable skill into the agent's documented user-level
Agent Skills directory through the normal transactional plan/apply path. The agent card then shows
the live guidance state: **Enabled** when the exact skill is currently owned by Token Harness,
**Enabled externally** for a byte-identical user-owned skill, or an explicit not-enabled,
custom/conflict, or unavailable state. Existing \`token-harness\` skill directories are never
overwritten or silently adopted, and matching bytes alone never create an ownership claim. The
browser remains fully usable without any skill or second AI subscription. See
[RFC 0023](docs/rfcs/0023-guided-agent-skill-install.md) for the install and ownership boundary.
`;
const first=readme.indexOf(before);
if(first<0||readme.indexOf(before,first+before.length)>=0)throw new Error('README guided skill paragraph not found exactly once');
readme=readme.slice(0,first)+after+readme.slice(first+before.length);
fs.writeFileSync(readmePath,readme);
