import { readFile, writeFile } from 'node:fs/promises';

const path = 'README.md';
let text = await readFile(path, 'utf8');
const anchor = `browser remains fully usable without any skill or second AI subscription. See\n[RFC 0023](docs/rfcs/0023-guided-agent-skill-install.md) for the install and ownership boundary.\n`;
if (!text.includes(anchor)) throw new Error('README anchor missing');
const addition = `${anchor}\n### Measure context savings\n\nPaired task benchmarks can now report context exposure separately from quality, local tokens, and\nsubscription allowance. Capture baseline and optimized variants with the existing benchmark workflow,\nthen inspect one pair or the current-project matrix:\n\n\`\`\`sh\ntoken-harness benchmark --baseline baseline.json --optimized optimized.json\ntoken-harness benchmark-matrix\n\`\`\`\n\nWhen both variants pass quality and each context surface stays stable from task start to finish, the\nreport can show evidence such as **Context: reduced — static MCP tools 62 → 5**. Truncated MCP\ninventory, unknown tool counts, missing observations, or mid-task context drift produce **unknown**\ninstead of a saving claim. Context reduction is context-shape evidence only; it is never converted\ninto Claude/Codex subscription quota. This evidence is the admission gate for experimental broad\ncontext owners such as Headroom or Context Mode.\n`;
text = text.replace(anchor, addition);
await writeFile(path, text);
