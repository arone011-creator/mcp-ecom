// scripts/scorecard.ts
//
// Metrics-based TDD harness. Captures one entry per milestone into
// metrics/scorecard.json (committed -- the file's git history is the trend
// line) and refuses to pass the gate when a metric has regressed.
//
//   npm run scorecard -- m1-storefront --gate
//   SCORECARD_BASE_URL=https://... npm run scorecard -- m1-storefront --gate

import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export type Timing = { p50: number; p95: number };

export type Entry = {
  milestone: string;
  capturedAt: string;
  commit: string;
  tests: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  };
  coverage: {
    statements: number;
    branches: number;
    // Absolutes matter: percentages alone cannot tell "we covered less"
    // apart from "we started measuring more code". Gate 1 hit exactly
    // that -- an unrelated import fix made two more files loadable under
    // jest, the denominator grew 134 -> 245, and the percentage fell
    // without a single line losing coverage.
    statementsCovered: number;
    statementsTotal: number;
    branchesCovered: number;
    branchesTotal: number;
  };
  typeErrors: number;
  build: { durationMs: number; standaloneBytes: number };
  latency: Record<string, Timing> | null;
  acceptedRegressions: string[];
  note?: string;
};

const SCORECARD_PATH = join(process.cwd(), 'metrics', 'scorecard.json');
const BUILD_TOLERANCE = 1.1;
const LATENCY_TOLERANCE = 1.25;
const PROBE_PATHS = ['/', '/search?q=iphone', '/api/v1/products?q=shoes&limit=5'];
const LATENCY_SAMPLES = 20;

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return Math.round(sorted[index] ?? 0);
}

export function compare(previous: Entry | undefined, current: Entry): string[] {
  const accepted = new Set(current.acceptedRegressions);
  const found: string[] = [];

  const flag = (key: string, message: string) => {
    if (!accepted.has(key)) found.push(message);
  };

  // Absolute gates -- these hold with or without a previous entry.
  // Skipped tests are not failures, but a rising skip count hides work, so
  // that is checked as a relative gate below.
  if (current.tests.failed > 0) {
    flag('tests', `tests failing: ${current.tests.failed}`);
  }
  if (current.typeErrors > 0) {
    flag('typeErrors', `typeErrors: ${current.typeErrors}`);
  }
  // A build that emits nothing is a failed build, not a small one. Without
  // this the harness reports "no regressions" on an undeployable app.
  if (current.build.standaloneBytes === 0) {
    flag('build', 'build produced no output (next build failed)');
  }

  if (!previous) return found;

  if (current.tests.skipped > previous.tests.skipped) {
    flag(
      'tests.skipped',
      `tests.skipped: ${previous.tests.skipped} -> ${current.tests.skipped}`
    );
  }

  // Relative gates.
  // Covering fewer lines is always a regression. A falling percentage is
  // only a regression when the measured surface did not grow -- otherwise
  // it just means newly visible code is less well covered than what was
  // already there, which is information, not a step backwards.
  const coverageRegressed = (
    kind: 'statements' | 'branches',
    coveredKey: 'statementsCovered' | 'branchesCovered',
    totalKey: 'statementsTotal' | 'branchesTotal'
  ) => {
    const before = previous.coverage;
    const after = current.coverage;

    if (after[coveredKey] < before[coveredKey]) {
      flag(
        `coverage.${kind}`,
        `coverage.${kind}: covered ${before[coveredKey]} -> ${after[coveredKey]} ` +
          `(of ${before[totalKey]} -> ${after[totalKey]})`
      );
      return;
    }

    if (after[kind] < before[kind] && after[totalKey] <= before[totalKey]) {
      flag(
        `coverage.${kind}`,
        `coverage.${kind}: ${before[kind]}% -> ${after[kind]}%`
      );
    }
  };

  coverageRegressed('statements', 'statementsCovered', 'statementsTotal');
  coverageRegressed('branches', 'branchesCovered', 'branchesTotal');
  if (current.build.durationMs > previous.build.durationMs * BUILD_TOLERANCE) {
    flag(
      'build.durationMs',
      `build.durationMs: ${previous.build.durationMs} -> ${current.build.durationMs}`
    );
  }
  if (
    current.build.standaloneBytes >
    previous.build.standaloneBytes * BUILD_TOLERANCE
  ) {
    flag(
      'build.standaloneBytes',
      `build.standaloneBytes: ${previous.build.standaloneBytes} -> ${current.build.standaloneBytes}`
    );
  }

  if (previous.latency && current.latency) {
    for (const [path, timing] of Object.entries(current.latency)) {
      const before = previous.latency[path];
      if (before && timing.p95 > before.p95 * LATENCY_TOLERANCE) {
        flag(
          `latency.${path}`,
          `latency ${path} p95: ${before.p95}ms -> ${timing.p95}ms`
        );
      }
    }
  }

  return found;
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    total += item.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

function collectTests() {
  const resultPath = join(process.cwd(), 'metrics', '.jest-result.json');

  spawnSync(
    'npx',
    [
      'jest',
      '--silent',
      '--coverage',
      '--coverageReporters=json-summary',
      '--json',
      `--outputFile=${resultPath}`,
    ],
    { stdio: 'inherit', shell: true }
  );

  const result = JSON.parse(readFileSync(resultPath, 'utf-8'));
  const summaryPath = join(process.cwd(), 'coverage', 'coverage-summary.json');
  const empty = { pct: 0, covered: 0, total: 0 };
  const summary = existsSync(summaryPath)
    ? JSON.parse(readFileSync(summaryPath, 'utf-8'))
    : { total: { statements: empty, branches: empty } };

  return {
    tests: {
      passed: result.numPassedTests as number,
      failed: result.numFailedTests as number,
      skipped: result.numPendingTests as number,
      total: result.numTotalTests as number,
    },
    coverage: {
      statements: summary.total.statements.pct as number,
      branches: summary.total.branches.pct as number,
      statementsCovered: summary.total.statements.covered as number,
      statementsTotal: summary.total.statements.total as number,
      branchesCovered: summary.total.branches.covered as number,
      branchesTotal: summary.total.branches.total as number,
    },
  };
}

function collectTypeErrors(): number {
  const res = spawnSync('npx', ['tsc', '--noEmit'], {
    encoding: 'utf-8',
    shell: true,
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return (output.match(/error TS\d+/g) ?? []).length;
}

function collectBuild() {
  const started = Date.now();
  spawnSync('npx', ['next', 'build'], { stdio: 'inherit', shell: true });
  return {
    durationMs: Date.now() - started,
    standaloneBytes: dirSize(join(process.cwd(), '.next', 'standalone')),
  };
}

async function collectLatency(baseUrl: string) {
  const results: Record<string, Timing> = {};

  for (const path of PROBE_PATHS) {
    const timings: number[] = [];
    for (let i = 0; i < LATENCY_SAMPLES; i++) {
      const started = Date.now();
      try {
        await fetch(`${baseUrl}${path}`);
      } catch {
        // A failed probe still consumed wall-clock time; record it rather
        // than silently shrinking the sample.
      }
      timings.push(Date.now() - started);
    }
    results[path] = {
      p50: percentile(timings, 50),
      p95: percentile(timings, 95),
    };
  }

  return results;
}

function loadEntries(): Entry[] {
  if (!existsSync(SCORECARD_PATH)) return [];
  return (JSON.parse(readFileSync(SCORECARD_PATH, 'utf-8')).entries ??
    []) as Entry[];
}

async function main() {
  const milestone = process.argv[2];
  if (!milestone || milestone.startsWith('--')) {
    console.error('Usage: npm run scorecard -- <milestone> [--gate]');
    console.error('Set SCORECARD_BASE_URL to also capture deployed latency.');
    process.exit(1);
  }

  const gate = process.argv.includes('--gate');
  const baseUrl = process.env.SCORECARD_BASE_URL;

  mkdirSync(join(process.cwd(), 'metrics'), { recursive: true });

  const { tests, coverage } = collectTests();
  const typeErrors = collectTypeErrors();
  const build = collectBuild();
  const latency = baseUrl ? await collectLatency(baseUrl) : null;

  const entry: Entry = {
    milestone,
    capturedAt: new Date().toISOString(),
    commit: execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim(),
    tests,
    coverage,
    typeErrors,
    build,
    latency,
    acceptedRegressions: [],
  };

  const entries = loadEntries();
  const previous = entries[entries.length - 1];
  const regressions = compare(previous, entry);

  console.log(`\nScorecard -- ${milestone} @ ${entry.commit}`);
  console.log(
    `  tests            ${tests.passed} passed, ${tests.failed} failed, ` +
      `${tests.skipped} skipped (${tests.total} total)`
  );
  console.log(
    `  coverage stmts   ${coverage.statements}% ` +
      `(${coverage.statementsCovered}/${coverage.statementsTotal})`
  );
  console.log(
    `  coverage branch  ${coverage.branches}% ` +
      `(${coverage.branchesCovered}/${coverage.branchesTotal})`
  );
  console.log(`  type errors      ${typeErrors}`);
  console.log(`  build            ${Math.round(build.durationMs / 1000)}s`);
  console.log(
    `  standalone       ${Math.round(build.standaloneBytes / 1_000_000)}MB`
  );
  if (latency) {
    for (const [path, timing] of Object.entries(latency)) {
      console.log(`  p95 ${path}  ${timing.p95}ms`);
    }
  }

  entries.push(entry);
  writeFileSync(SCORECARD_PATH, `${JSON.stringify({ entries }, null, 2)}\n`);

  if (regressions.length > 0) {
    console.error(
      `\nRegressions against ${previous ? previous.milestone : 'absolute gates'}:`
    );
    regressions.forEach(r => console.error(`  - ${r}`));
    console.error(
      '\nFix them, or add the metric key to "acceptedRegressions" on this ' +
        'entry with a reason and re-run.'
    );
    if (gate) process.exit(1);
  } else {
    console.log('\nNo regressions.');
  }
}

// Only run when invoked as a script. Without this guard, importing the module
// in a test would kick off a full jest + tsc + next build run.
if (!process.env.JEST_WORKER_ID) {
  void main();
}
