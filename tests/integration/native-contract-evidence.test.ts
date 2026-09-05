/** Durable projections from unauthenticated real CLI probes, never task benchmarks. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('recorded native contract evidence', () => {
  for (const platform of ['windows', 'macos', 'linux']) {
    it(platform + ' records CLI contracts without inventing runtime or quota evidence', () => {
      const value = JSON.parse(
        readFileSync(
          new URL(
            '../../fixtures/native-contracts/2026-09-05/' + platform + '.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ) as {
        measurementClass: string;
        versions: { claude: string; codex: string; cclimits: string };
        claudeDoctorExitCodes: Record<string, number>;
        cclimitsSyntheticCache: {
          claude: { source: string; five_hour: { used: string }; seven_day: { used: string } };
        };
        codexHooksList: { data: { hooks: { enabled: boolean; trustStatus: string }[] }[] };
        codexHooksExitCode: number;
      };
      assert.equal(value.measurementClass, 'native-contract-not-task-runtime');
      assert.deepEqual(value.versions, { claude: '2.1.261', codex: '0.153.4', cclimits: '1.7.0' });
      assert.deepEqual(value.claudeDoctorExitCodes, { low: 0, medium: 0, high: 0, xhigh: 0 });
      assert.equal(value.cclimitsSyntheticCache.claude.source, 'claude_code_cache');
      assert.equal(value.cclimitsSyntheticCache.claude.five_hour.used, '18.0%');
      assert.equal(value.cclimitsSyntheticCache.claude.seven_day.used, '42.0%');
      assert.equal(value.codexHooksExitCode, 0);
      assert.equal(value.codexHooksList.data[0]?.hooks[0]?.enabled, true);
      assert.equal(value.codexHooksList.data[0]?.hooks[0]?.trustStatus, 'untrusted');
    });
  }
});
