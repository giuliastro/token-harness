#!/usr/bin/env node
// Workspace launcher. The self-contained ESM artifact is produced by
// `pnpm build` into dist/bundle/token-harness.mjs at the repository root; this
// file exists so `bin` resolves before anything has been built or bundled.
import { main } from '../dist/src/main.js';

await main(process.argv.slice(2));
