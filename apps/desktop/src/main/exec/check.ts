/**
 * `npm run check:exec-host`: drive the real execution host window in Electron
 * and check what the Vitest suite cannot (it runs Pyodide on Node threads):
 * the page and its workers load under their CSP, nothing leaves the
 * partition, and the executor behaves the same in Chromium.
 *
 *   electron out/main/exec-check.js [--measure <dsa-tutor>/problems/curated]
 *
 * `--measure` runs every reference solution and prints its slowest test
 * (DECISIONS D-15). Prints JSON lines; exits 1 if a check fails.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, session } from 'electron';
import { parseJson, type RunJob, type Signature, type TestCase } from '@algo/core';
import { EXEC_PARTITION, ExecHost, registerExecScheme } from './host-window';
import { PyodideExecutor } from './pyodide-executor';

registerExecScheme();
app.commandLine.appendSwitch('disable-gpu');

const blocked: string[] = [];
const failures: string[] = [];
const log = (o: object): void => console.log(JSON.stringify(o));

function check(name: string, ok: boolean, detail?: unknown): void {
  log({ check: name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) failures.push(name);
}

const job = (code: string, tests: TestCase[], over: Partial<RunJob> = {}): RunJob => ({
  language: 'python',
  code,
  signature: { function: 'f', params: [{ name: 'n', type: 'int' }], returns: 'int' },
  compare: { mode: 'exact' },
  tests,
  timeLimitMs: 1000,
  memoryLimitMb: 512,
  ...over,
});
const t = (id: string, n: unknown, expected: unknown): TestCase => ({
  id,
  visibility: 'visible',
  input: { n },
  expected,
});

async function checks(host: ExecHost, executor: PyodideExecutor): Promise<void> {
  let t0 = performance.now();
  const status = await executor.status();
  check('status', status.available, {
    ...status,
    firstStartMs: Math.round(performance.now() - t0),
  });

  t0 = performance.now();
  let r = await executor.run(
    job('def f(n):\n    print(n)\n    return n * 2\n', [
      t('a', 2, 4),
      t('b', 2n ** 62n, 2n ** 63n),
    ]),
  );
  check(
    'pass, big ints, stdout',
    r.results.every((x) => x.status === 'pass') && r.results[0]!.stdout === '2\n',
    {
      ms: Math.round(performance.now() - t0),
      results: r.results.map((x) => x.status),
    },
  );

  r = await executor.run(job('def f(n):\n    return [1][n]\n', [t('a', 3, 0)]));
  check(
    'runtime error',
    r.results[0]!.status === 'error' && r.results[0]!.line === 2,
    r.results[0]!.message,
  );

  r = await executor.run(job('def f(n)\n', [t('a', 3, 0)]));
  check('syntax error', r.error?.kind === 'compile', r.error);

  t0 = performance.now();
  r = await executor.run(
    job('def f(n):\n    while n:\n        pass\n    return 0\n', [t('a', 1, 0), t('b', 0, 0)], {
      timeLimitMs: 500,
    }),
  );
  check(
    'timeout kills, next test runs',
    r.results[0]!.status === 'timeout' && r.results[1]!.status === 'pass',
    {
      ms: Math.round(performance.now() - t0),
    },
  );
  r = await executor.run(job('def f(n):\n    return 1\n', [t('a', 1, 1)]));
  check('next job after timeout', r.results[0]!.status === 'pass');

  t0 = performance.now();
  r = await executor.run(
    job(
      'def f(n):\n    return 0 if n == 0 else 1 + max(f(n - 1), 0)\n',
      [t('deep', 10 ** 6, 0), t('ok', 2, 2)],
      {
        timeLimitMs: 10_000,
      },
    ),
  );
  check(
    'runaway recursion is a RecursionError',
    r.results[0]!.errorType === 'RecursionError' && r.results[1]!.status === 'pass',
    { ms: Math.round(performance.now() - t0), first: r.results[0]!.message },
  );
  r = await executor.run(
    job('def f(n):\n    return 0 if n == 0 else 1 + f(n - 1)\n', [t('depth-5000', 5000, 5000)]),
  );
  check('pure-Python recursion 5000 deep', r.results[0]!.status === 'pass', r.results[0]!.message);

  r = await executor.run(
    job('def f(n):\n    print("x" * 1000000)\n    return 1\n', [t('a', 1, 1)]),
  );
  check(
    'large output truncated',
    (r.results[0]!.stdout?.length ?? 0) < 2100,
    r.results[0]!.stdout?.slice(0, 50),
  );

  for (const [name, body, want] of [
    ['js.fetch', 'import js\n    js.fetch("https://example.com")', /^AttributeError/],
    ['open /etc/passwd', 'open("/etc/passwd")', /^FileNotFoundError/],
    ['import micropip', 'import micropip', /^(ImportError|ModuleNotFoundError)/],
    ['import pyodide.http', 'import pyodide.http', /^ImportError/],
    ['run_js', 'from pyodide.code import run_js', /^ImportError/],
    ['pyodide_js.loadPackage', 'import pyodide_js', /^ImportError/],
  ] as const) {
    r = await executor.run(job(`def f(n):\n    ${body}\n    return 0\n`, [t('a', 1, 0)]));
    check(
      `blocked: ${name}`,
      r.results[0]!.status === 'error' && want.test(r.results[0]!.message ?? ''),
      r.results[0]!.message,
    );
  }

  // The page itself cannot reach the network (CSP connect-src 'none').
  const pageFetch = await host.evaluate(
    "fetch('https://example.com/').then(() => 'reached', (e) => 'blocked: ' + e.message)",
  );
  check('page fetch blocked', String(pageFetch).startsWith('blocked'), pageFetch);
  const pageImage = await host.evaluate(
    "new Promise((res) => { const i = new Image(); i.onload = () => res('reached'); i.onerror = () => res('blocked'); i.src = 'https://example.com/x.png'; })",
  );
  check('page image blocked', pageImage === 'blocked', pageImage);
  // A worker from a blob: URL would escape the worker CSP; worker-src forbids it.
  const blobWorker = await host.evaluate(
    "new Promise((res) => { try { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1)']))); w.onmessage = () => res('ran'); w.onerror = () => res('blocked'); setTimeout(() => res('no answer'), 3000); } catch (e) { res('blocked: ' + e.name); } })",
  );
  check('blob worker blocked', String(blobWorker).startsWith('blocked'), blobWorker);
  // Below the CSP: the partition's own requests are cancelled by webRequest.
  const ses = session.fromPartition(EXEC_PARTITION);
  const sesFetch = await ses.fetch('https://example.com/').then(
    () => 'reached',
    (e: unknown) => `blocked: ${String(e)}`,
  );
  check(
    'partition request cancelled',
    sesFetch.startsWith('blocked') && blocked.some((u) => u.startsWith('https://example.com')),
    {
      sesFetch,
      blocked,
    },
  );
  check(
    'only the execution host scheme was requested',
    blocked.every((u) => u.startsWith('https://example.com')),
    blocked,
  );
}

// ------------------------------------------------------------ measuring

/** Python type hints in dsa-tutor's v1 signatures → neutral types (T04 does this properly). */
function neutral(py: string): string {
  const t = py.replace(/\s/g, '');
  const map: Record<string, string> = {
    int: 'int',
    float: 'float',
    bool: 'bool',
    str: 'string',
    'ListNode|None': 'linked_list<int>',
    'TreeNode|None': 'tree<int>',
  };
  if (map[t]) return map[t];
  const m = t.match(/^list\[(.*)\]$/);
  if (m) return `list<${neutral(m[1]!)}>`;
  throw new Error(`no neutral type for ${py}`);
}

async function measure(executor: PyodideExecutor, root: string): Promise<void> {
  const rows: {
    slug: string;
    tests: number;
    slowestMs: number;
    totalMs: number;
    passed: boolean;
  }[] = [];
  for (const topic of (await readdir(root)).sort()) {
    for (const slug of (await readdir(join(root, topic)).catch(() => [])).sort()) {
      const dir = join(root, topic, slug);
      const meta = parseJson(await readFile(join(dir, 'meta.json'), 'utf8')) as {
        compare?: RunJob['compare'];
        signatures: {
          python: { function: string; params: { name: string; type: string }[]; returns: string };
        };
      };
      const tests = (
        parseJson(await readFile(join(dir, 'tests.json'), 'utf8')) as { tests: TestCase[] }
      ).tests;
      const py = meta.signatures.python;
      const signature: Signature = {
        function: py.function,
        params: py.params.map((p) => ({ name: p.name, type: neutral(p.type) })),
        returns: neutral(py.returns),
      };
      const code = await readFile(join(dir, 'reference.py'), 'utf8');
      const r = await executor.run(
        job(code, tests, {
          signature,
          compare: meta.compare ?? { mode: 'exact' },
          timeLimitMs: 60_000,
        }),
      );
      const times = r.results.map((x) => x.timeMs ?? 0);
      const row = {
        slug,
        tests: tests.length,
        slowestMs: Math.round(Math.max(...times) * 10) / 10,
        totalMs: Math.round(times.reduce((a, b) => a + b, 0)),
        passed: r.ok && r.results.every((x) => x.status === 'pass'),
      };
      rows.push(row);
      log({
        measure: row,
        ...(row.passed ? {} : { failed: r.results.filter((x) => x.status !== 'pass').slice(0, 3) }),
      });
    }
  }
  rows.sort((a, b) => b.slowestMs - a.slowestMs);
  log({
    summary: {
      problems: rows.length,
      allPassed: rows.every((r) => r.passed),
      slowest: rows.slice(0, 5),
    },
  });
  if (!rows.every((r) => r.passed)) failures.push('measure');
}

void app.whenReady().then(async () => {
  const host = new ExecHost({
    rendererDir: join(import.meta.dirname, '../renderer'),
    preloadPath: join(import.meta.dirname, '../preload/exec-host.cjs'),
    // Under `electron-vite dev --entry out/main/exec-check.js`: the dev server.
    devServerUrl: process.env['ELECTRON_RENDERER_URL'],
    onBlocked: (url) => blocked.push(url),
    onConsole: (message) => log({ console: message }),
  });
  const executor = new PyodideExecutor(host);
  try {
    const at = process.argv.indexOf('--measure');
    if (at > 0 && process.argv[at + 1]) await measure(executor, process.argv[at + 1]!);
    else await checks(host, executor);
  } catch (e) {
    failures.push(`crashed: ${String(e)}`);
    log({ error: String(e) });
  }
  log({ done: true, failures });
  host.dispose();
  app.exit(failures.length ? 1 : 0);
});
