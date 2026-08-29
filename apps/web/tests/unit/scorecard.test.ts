// tests/unit/scorecard.test.ts
import { compare, percentile, type Entry } from '@/scripts/scorecard';

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    milestone: 'test',
    capturedAt: '2026-08-27T00:00:00.000Z',
    commit: 'abc1234',
    tests: { passed: 10, failed: 0, skipped: 0, total: 10 },
    coverage: {
      statements: 80,
      branches: 70,
      statementsCovered: 80,
      statementsTotal: 100,
      branchesCovered: 70,
      branchesTotal: 100,
    },
    typeErrors: 0,
    build: { durationMs: 60000, standaloneBytes: 100_000_000 },
    latency: null,
    acceptedRegressions: [],
    ...overrides,
  };
}

describe('percentile', () => {
  it('returns the median for p50', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });

  it('returns the top of the range for p95', () => {
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
  });

  it('is order independent', () => {
    expect(percentile([50, 10, 40, 20, 30], 50)).toBe(30);
  });

  it('returns 0 for an empty sample rather than NaN', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('compare', () => {
  it('reports nothing when there is no previous entry', () => {
    expect(compare(undefined, entry())).toEqual([]);
  });

  it('reports nothing when every metric holds', () => {
    expect(compare(entry(), entry())).toEqual([]);
  });

  it('fails any entry with failing tests, even with no previous entry', () => {
    const current = entry({
      tests: { passed: 9, failed: 1, skipped: 0, total: 10 },
    });
    expect(compare(undefined, current)).toEqual([
      expect.stringContaining('tests failing: 1'),
    ]);
  });

  it('does not treat skipped tests as failures', () => {
    const current = entry({
      tests: { passed: 164, failed: 0, skipped: 12, total: 176 },
    });
    expect(compare(undefined, current)).toEqual([]);
  });

  it('flags a rising skip count, which hides work', () => {
    const previous = entry({
      tests: { passed: 164, failed: 0, skipped: 12, total: 176 },
    });
    const current = entry({
      tests: { passed: 160, failed: 0, skipped: 16, total: 176 },
    });
    expect(compare(previous, current)).toEqual([
      expect.stringContaining('tests.skipped: 12 -> 16'),
    ]);
  });

  it('fails any entry whose build produced no output, even with no previous entry', () => {
    const current = entry({
      build: { durationMs: 60000, standaloneBytes: 0 },
    });
    expect(compare(undefined, current)).toEqual([
      expect.stringContaining('build produced no output'),
    ]);
  });

  it('fails any entry with type errors', () => {
    expect(compare(entry(), entry({ typeErrors: 3 }))).toEqual([
      expect.stringContaining('typeErrors: 3'),
    ]);
  });

  it('flags a drop in statement coverage', () => {
    const current = entry({
      coverage: {
        statements: 79,
        branches: 70,
        statementsCovered: 79,
        statementsTotal: 100,
        branchesCovered: 70,
        branchesTotal: 100,
      },
    });
    expect(compare(entry(), current)).toEqual([
      expect.stringContaining('coverage.statements: covered 80 -> 79'),
    ]);
  });

  it('flags a drop in branch coverage', () => {
    const current = entry({
      coverage: {
        statements: 80,
        branches: 69,
        statementsCovered: 80,
        statementsTotal: 100,
        branchesCovered: 69,
        branchesTotal: 100,
      },
    });
    expect(compare(entry(), current)).toEqual([
      expect.stringContaining('coverage.branches: covered 70 -> 69'),
    ]);
  });

  it('records build duration but never gates on it', () => {
    // Measured three times on identical code: 195s, 220s, 255s -- a 30%
    // spread, and the slowest run was on an otherwise idle machine. A
    // metric whose noise exceeds its own tolerance can only produce false
    // alarms, so it is reported and not gated (finding 51).
    const muchSlower = entry({
      build: { durationMs: 600000, standaloneBytes: 100_000_000 },
    });
    expect(compare(entry(), muchSlower)).toEqual([]);
  });

  it('still gates on bundle size, which is stable', () => {
    const bloated = entry({
      build: { durationMs: 60000, standaloneBytes: 120_000_000 },
    });
    expect(compare(entry(), bloated)).toEqual([
      expect.stringContaining('build.standaloneBytes'),
    ]);
  });

  it('flags a p95 latency regression beyond 25%', () => {
    const previous = entry({ latency: { '/': { p50: 100, p95: 200 } } });
    const current = entry({ latency: { '/': { p50: 100, p95: 260 } } });
    expect(compare(previous, current)).toEqual([
      expect.stringContaining('latency / p95: 200ms -> 260ms'),
    ]);
  });

  it('ignores a latency path the previous entry did not measure', () => {
    const previous = entry({ latency: { '/': { p50: 100, p95: 200 } } });
    const current = entry({
      latency: {
        '/': { p50: 100, p95: 200 },
        '/api/v1/products': { p50: 900, p95: 2000 },
      },
    });
    expect(compare(previous, current)).toEqual([]);
  });

  it('does not call it a regression when the measured surface grew', () => {
    // Gate 1 hit this for real: fixing an unrelated import made two more
    // files loadable under jest, so they entered the coverage report for
    // the first time and the percentage fell from 70.89 to 60 while not a
    // single line lost coverage.
    const previous = entry({
      coverage: {
        statements: 70.89,
        branches: 70.58,
        statementsCovered: 95,
        statementsTotal: 134,
        branchesCovered: 36,
        branchesTotal: 51,
      },
    });
    const current = entry({
      coverage: {
        statements: 60,
        branches: 57.69,
        statementsCovered: 147,
        statementsTotal: 245,
        branchesCovered: 45,
        branchesTotal: 78,
      },
    });
    expect(compare(previous, current)).toEqual([]);
  });

  it('flags a real regression when fewer statements are covered', () => {
    const previous = entry();
    const current = entry({
      coverage: {
        statements: 75,
        branches: 70,
        statementsCovered: 75,
        statementsTotal: 100,
        branchesCovered: 70,
        branchesTotal: 100,
      },
    });
    expect(compare(previous, current)).toEqual([
      expect.stringContaining('coverage.statements'),
    ]);
  });

  it('flags fewer covered branches even when the percentage rose', () => {
    // Deleting well-tested code raises the percentage while covering less.
    const previous = entry();
    const current = entry({
      coverage: {
        statements: 80,
        branches: 90,
        statementsCovered: 80,
        statementsTotal: 100,
        branchesCovered: 45,
        branchesTotal: 50,
      },
    });
    expect(compare(previous, current)).toEqual([
      expect.stringContaining('coverage.branches'),
    ]);
  });

  it('suppresses a regression that has been explicitly accepted', () => {
    const current = entry({
      typeErrors: 3,
      acceptedRegressions: ['typeErrors'],
    });
    expect(compare(entry(), current)).toEqual([]);
  });

  it('reports every independent regression at once', () => {
    const current = entry({
      typeErrors: 2,
      coverage: {
        statements: 70,
        branches: 60,
        statementsCovered: 70,
        statementsTotal: 100,
        branchesCovered: 60,
        branchesTotal: 100,
      },
    });
    expect(compare(entry(), current)).toHaveLength(3);
  });
});

describe('mcp gate', () => {
  const timing = (p95: number, successRate = 1, p50 = 40) => ({
    p50,
    p95,
    successRate,
  });

  it('says nothing about mcp when no sweep was captured', () => {
    expect(compare(entry(), entry())).toEqual([]);
  });

  it('passes a fully succeeding sweep with no previous entry', () => {
    const current = entry({ mcp: { get_cart: timing(60) } });

    expect(compare(undefined, current)).toEqual([]);
  });

  it('flags a tool that stopped succeeding, with or without a baseline', () => {
    // A tool that fails some of the time is broken, not slow. Gated
    // absolutely, because there is no previous number that makes a 0.8
    // success rate acceptable.
    const current = entry({ mcp: { get_cart: timing(60, 0.8) } });

    expect(compare(undefined, current)).toContainEqual(
      expect.stringContaining('mcp.get_cart success rate')
    );
  });

  it('flags a tool that got materially slower', () => {
    const previous = entry({ mcp: { get_cart: timing(100) } });
    const current = entry({ mcp: { get_cart: timing(200) } });

    expect(compare(previous, current)).toContainEqual(
      expect.stringContaining('mcp get_cart p95: 100ms -> 200ms')
    );
  });

  it('tolerates noise inside the same window the http gate allows', () => {
    const previous = entry({ mcp: { get_cart: timing(100) } });
    const current = entry({ mcp: { get_cart: timing(120) } });

    expect(compare(previous, current)).toEqual([]);
  });

  it('flags a tool that disappeared from the sweep', () => {
    // Otherwise deleting a tool is the easiest way to pass this gate.
    const previous = entry({
      mcp: { get_cart: timing(100), get_order: timing(100) },
    });
    const current = entry({ mcp: { get_cart: timing(100) } });

    expect(compare(previous, current)).toContainEqual(
      expect.stringContaining('mcp.get_order missing')
    );
  });

  it('does not flag a tool measured for the first time', () => {
    const previous = entry({ mcp: { get_cart: timing(100) } });
    const current = entry({
      mcp: { get_cart: timing(100), get_order: timing(500) },
    });

    expect(compare(previous, current)).toEqual([]);
  });

  it('respects acceptedRegressions like every other gate', () => {
    const previous = entry({ mcp: { get_cart: timing(100) } });
    const current = entry({
      mcp: { get_cart: timing(400) },
      acceptedRegressions: ['mcp.get_cart'],
    });

    expect(compare(previous, current)).toEqual([]);
  });

  it('ignores a previous sweep when this milestone captured none', () => {
    // A milestone that did not run the sweep has not regressed; it has
    // not measured. Flagging every tool as missing would be noise.
    const previous = entry({ mcp: { get_cart: timing(100) } });

    expect(compare(previous, entry())).toEqual([]);
  });
});
