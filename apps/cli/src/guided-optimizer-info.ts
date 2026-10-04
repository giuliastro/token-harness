/** Editorial project information. Upstream claims never enter the measured-results pipeline.
 * Sources checked 2026-10-04; see docs/spikes/optimizer-project-information.md.
 */
export const GUIDE_OPTIMIZER_INFO = {
  rtk: {
    name: 'RTK',
    role: 'Keeps test, build and Git output short so your agent spends less context on noise.',
    project: 'https://github.com/rtk-ai/rtk',
    managed: true,
    useful:
      'A good baseline when your agent runs many shell commands, especially verbose tests, builds and repository searches.',
    mechanism:
      'A command proxy filters supported CLI output before the agent reads it, keeping the useful summary and errors.',
    limitation:
      'Only supported command output is affected. Prompts, conversation history and model responses are outside this figure; total-session impact depends on your workload.',
    claim: {
      headline: 'Up to 90% less',
      scope: 'Supported shell-command output',
      context:
        'The project headline compares raw and filtered Bash output. Absolute token counts use bytes ÷ 4 estimates; the headline is not a fixed-suite result or a whole-session saving.',
      source: 'https://github.com/rtk-ai/rtk#how-savings-work',
    },
  },
  harnesstrim: {
    name: 'HarnessTrim',
    role: 'Trims repetitive logs and adds guidance that helps agents keep context lean.',
    project: 'https://github.com/giuliastro/HarnessTrim',
    managed: true,
    useful:
      'Useful for long test logs, lint warnings, large diffs, JSON and file listings, with agent guidance across supported coding apps.',
    mechanism:
      'Deterministic reducers remove repetitive output while retaining required signals. Harness integrations and skills help agents use those reducers.',
    limitation:
      'Only output sent through a reducer is shortened. The reviewed integration can use instructions or hooks depending on the app and version; setup does not prove every tool is intercepted.',
    claim: {
      headline: '75.8% less',
      scope: 'Output tokens · 10 fixed fixtures',
      context:
        'The published suite goes from 7,747 to 1,876 cl100k_base tokens, retaining 48/48 required signals. Fixture signal retention does not establish live coding-task quality.',
      source: 'https://github.com/giuliastro/HarnessTrim#measured-evidence-with-boundaries',
    },
  },
  mcptoon: {
    name: 'mcptoon',
    role: 'Loads MCP tool definitions on demand instead of keeping the full catalog in context.',
    project: 'https://github.com/activeing123/mcptoon',
    managed: true,
    optional: true,
    useful:
      'Consider it when many MCP tools make discovery expensive. Compare it with your app’s native deferred tool loading first; small catalogs may gain little.',
    mechanism:
      'A compact tool-name index supports discovery; the agent retrieves detailed schemas when needed. Actual tool calls remain JSON.',
    limitation:
      'The headline measures a name index, not full schemas or tool results. On-demand schema reads add context; native tool search and your current stack change the marginal benefit.',
    claim: {
      headline: '99.2% less',
      scope: 'Discovery index · 255 tools',
      context:
        'Published Sample B: 71,929 full-schema tokens → 581 name-index tokens. The richer SLIM schema format is 8,282 tokens (88.5% less), measured with tiktoken.',
      source: 'https://github.com/activeing123/mcptoon/blob/main/docs/tiktoken-benchmarks.md',
    },
  },
  gitnexus: {
    name: 'GitNexus',
    role: 'Maps code relationships so your agent can find symbols, dependencies and affected code.',
    project: 'https://github.com/abhigyanpatwari/GitNexus',
    managed: true,
    optional: true,
    useful:
      'Consider it for unfamiliar or large repositories, call-chain tracing and change-impact analysis where repeated searches miss relationships.',
    mechanism:
      'Builds a local code knowledge graph and exposes focused repository queries through MCP.',
    limitation:
      'Needs an up-to-date repository index; Token Harness registers the integration but does not create or refresh that index. The reviewed version has PolyForm Noncommercial terms: check that they fit your use.',
    claim: {
      headline: 'No published %',
      scope: 'Repository exploration',
      context:
        'The project describes more focused code navigation but publishes no comparable token-reduction benchmark in the reviewed README. Evaluate indexing cost and task quality on your repository.',
      source: 'https://github.com/abhigyanpatwari/GitNexus#why-a-knowledge-graph',
    },
  },
  headroom: {
    name: 'Headroom',
    role: 'Compresses large tool payloads and retrieves relevant context through local MCP tools.',
    project: 'https://github.com/headroomlabs-ai/headroom',
    managed: true,
    optional: true,
    useful:
      'Consider it for large, repetitive JSON, search results or logs. Compact prose and already-trimmed outputs offer less room for improvement.',
    mechanism:
      'Compression and retrieval tools help keep bulky payloads out of context. Token Harness manages the local MCP integration.',
    limitation:
      'The managed MCP path does not enable the project’s broader proxy features. Library benchmarks do not establish savings from this integration or added value on top of existing reducers.',
    claim: {
      headline: '21–57% less',
      scope: 'Input tokens · 4 offline scenarios',
      context:
        'Published seeded compress() scenarios report 21%, 57%, 42% and 30% reductions. Codebase exploration goes from 58,801 to 33,895 provider-tokenizer tokens; results depend on payload repetition.',
      source: 'https://github.com/headroomlabs-ai/headroom#proof',
    },
  },
};
