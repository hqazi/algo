/**
 * `npm run check:harnesses` (T15): build and run the Rust and Go harnesses
 * with the real toolchains (`cargo`, `go` on PATH).
 *
 * - Five problems, one per tricky type (tree, linked list, map, tuple,
 *   float), each with a hand-written solution in `content/runners/<lang>/check/`,
 *   must pass every test, graded by core's `gradeRun`.
 * - The unchanged stub reports a panic with its line; a wrong answer fails; a
 *   runaway recursion is a crash; an endless loop is a timeout; printed text
 *   reaches the test's stdout.
 * - Every neutral type round-trips: `echo(x: T) -> T` returns its input.
 * - Every golden project (`packages/core/src/langs/golden/`, unchanged stub
 *   included) compiles.
 *
 *   npm run check:harnesses [-- rust|go]
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  crossCheckProblem,
  encodeHarnessInput,
  goProject,
  goStub,
  gradeRun,
  loadProblem,
  metaSchema,
  newNonce,
  parseHarnessStream,
  parseJson,
  rustProject,
  rustStub,
  testsFileSchema,
  toHarnessRequest,
  type HarnessProject,
  type ProblemMeta,
  type RunJob,
  type RunReport,
  type Signature,
  type TestCase,
} from '../packages/core/src/index';

type Lang = 'rust' | 'go';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNERS = join(ROOT, 'content', 'runners');
const FIXTURES = join(ROOT, 'packages', 'core', 'src', 'langs', 'fixtures');
const BUILD_TIMEOUT_MS = 300_000;
const RUN_TIMEOUT_MS = 10_000;

const langs: Lang[] = (['rust', 'go'] as const).filter(
  (l) => process.argv.length <= 2 || process.argv.includes(l),
);
const errors: string[] = [];
const fail = (where: string, message: string): void => {
  errors.push(`${where}: ${message}`);
  console.log(`FAIL ${where}: ${message}`);
};

// ------------------------------------------------------------- processes

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(cmd: string[], cwd: string, input = '', timeoutMs = RUN_TIMEOUT_MS): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const project = (lang: Lang, sig: Signature): HarnessProject =>
  lang === 'rust' ? rustProject(sig) : goProject(sig);
const stub = (lang: Lang, sig: Signature): string =>
  lang === 'rust' ? rustStub(sig) : goStub(sig);

/** Write the project with `code` as the solution and build it. Returns the folder. */
async function build(lang: Lang, sig: Signature, code: string): Promise<string> {
  const p = project(lang, sig);
  const dir = await mkdtemp(join(tmpdir(), `harness-${lang}-`));
  const put = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  };
  for (const f of p.files) await put(f.path, f.content);
  for (const f of p.runtimeFiles) {
    await put(f.path, await readFile(join(RUNNERS, lang, f.from), 'utf8'));
  }
  await put(p.solutionPath, code);
  const r = await run(p.build, dir, '', BUILD_TIMEOUT_MS);
  if (r.code !== 0) {
    throw new Error(`build failed in ${dir}:\n${r.stderr.slice(-3000)}`);
  }
  return dir;
}

/** Run the built harness on `job` and grade it. */
async function runJob(lang: Lang, dir: string, job: RunJob, timeoutMs = RUN_TIMEOUT_MS) {
  const p = project(lang, job.signature);
  const nonce = newNonce();
  const input = encodeHarnessInput(nonce, toHarnessRequest(job).inputs);
  const start = Date.now();
  const r = await run([join(dir, p.run[0]!), ...p.run.slice(1)], dir, input, timeoutMs);
  const output = parseHarnessStream(
    r.stdout,
    nonce,
    job.tests.length,
    r.timedOut ? { kind: 'timeout' } : { kind: 'exited', code: r.code, stderr: r.stderr },
  );
  return { report: gradeRun(job, output, Date.now() - start), raw: r };
}

function jobFor(lang: Lang, meta: ProblemMeta, tests: TestCase[], code: string): RunJob {
  return {
    language: lang,
    code,
    signature: meta.signature,
    compare: meta.compare,
    tests,
    timeLimitMs: meta.time_limit_ms,
    memoryLimitMb: 256,
  };
}

const summary = (r: RunReport): string =>
  r.results
    .map((x) => `${x.id}=${x.status}${x.message ? ` (${x.message.slice(0, 160)})` : ''}`)
    .join(', ');

// ----------------------------------------------------------- problems

const reader = { readText: (p: string) => readFile(p, 'utf8').catch(() => null) };

async function problem(slug: string): Promise<{ meta: ProblemMeta; tests: TestCase[] }> {
  const curated: Record<string, string> = {
    'mirror-tree': 'trees/mirror-tree',
    'reverse-chain': 'linked-list/reverse-chain',
  };
  if (curated[slug]) {
    const r = await loadProblem(reader, join(ROOT, 'content', 'problems', curated[slug]));
    if (!r.ok) throw new Error(`${slug}: ${r.errors.join('; ')}`);
    return { meta: r.problem.meta, tests: r.problem.tests };
  }
  const meta = metaSchema.parse(
    parseJson(await readFile(join(FIXTURES, slug, 'meta.json'), 'utf8')),
  );
  const tests = testsFileSchema.parse(
    parseJson(await readFile(join(FIXTURES, slug, 'tests.json'), 'utf8')),
  ).tests;
  const problems = crossCheckProblem(meta, tests);
  if (problems.length) throw new Error(`${slug}: ${problems.join('; ')}`);
  return { meta, tests };
}

const CHECK_PROBLEMS = [
  'mirror-tree',
  'reverse-chain',
  'group-lengths',
  'best-team',
  'basket-average',
];

async function checkSolutions(lang: Lang): Promise<void> {
  for (const slug of CHECK_PROBLEMS) {
    const where = `${lang} ${slug}`;
    try {
      const { meta, tests } = await problem(slug);
      const ext = lang === 'rust' ? 'rs' : 'go';
      const code = await readFile(join(RUNNERS, lang, 'check', `${slug}.${ext}`), 'utf8');
      const dir = await build(lang, meta.signature, code);
      const { report } = await runJob(lang, dir, jobFor(lang, meta, tests, code));
      if (!report.ok || report.results.some((r) => r.status !== 'pass')) {
        fail(where, summary(report));
      } else {
        console.log(`ok   ${where}: ${report.results.length} tests pass`);
      }
      if (slug === 'group-lengths' && !report.results[0]?.stdout?.includes('groups: 3')) {
        fail(
          where,
          `printed text missing from stdout: ${JSON.stringify(report.results[0]?.stdout)}`,
        );
      }
      await rm(dir, { recursive: true, force: true });
    } catch (e) {
      fail(where, (e as Error).message);
    }
  }
}

// ------------------------------------------------------- failure modes

async function checkFailures(lang: Lang): Promise<void> {
  const { meta, tests } = await problem('best-team');
  const sig = meta.signature;
  const cases: {
    name: string;
    code: string;
    expect: (r: RunReport) => string | null;
    timeoutMs?: number;
  }[] = [
    {
      name: 'unchanged stub',
      code: stub(lang, sig),
      expect: (r) => {
        const first = r.results[0]!;
        if (!r.results.every((x) => x.status === 'error')) return 'expected every test to error';
        if (first.errorType !== 'panic' || !first.line)
          return `expected a panic with a line, got ${JSON.stringify(first)}`;
        return null;
      },
    },
    {
      name: 'wrong answer',
      code:
        lang === 'rust'
          ? 'pub fn best_team(scores: Vec<(char, i64)>) -> Option<(char, i64)> {\n    scores.first().copied()\n}\n'
          : 'package main\n\nfunc bestTeam(scores []Tuple) *Tuple {\n\tif len(scores) == 0 {\n\t\treturn nil\n\t}\n\treturn &scores[0]\n}\n',
      expect: (r) =>
        r.results[0]!.status === 'fail' && r.results[1]!.status === 'pass'
          ? null
          : 'expected fail then pass',
    },
    {
      name: 'index out of range',
      code:
        lang === 'rust'
          ? 'pub fn best_team(scores: Vec<(char, i64)>) -> Option<(char, i64)> {\n    Some(scores[10])\n}\n'
          : 'package main\n\nfunc bestTeam(scores []Tuple) *Tuple {\n\treturn &scores[10]\n}\n',
      expect: (r) => {
        const first = r.results[0]!;
        return first.status === 'error' && first.line === (lang === 'rust' ? 2 : 4)
          ? null
          : `expected an error on line ${lang === 'rust' ? 2 : 4}, got ${JSON.stringify(first)}`;
      },
    },
    {
      name: 'runaway recursion',
      code:
        lang === 'rust'
          ? "pub fn best_team(scores: Vec<(char, i64)>) -> Option<(char, i64)> {\n    let mut s = scores;\n    s.push(('x', 1));\n    best_team(s)\n}\n"
          : 'package main\n\nfunc bestTeam(scores []Tuple) *Tuple {\n\tvar pad [64]int\n\t_ = pad\n\treturn bestTeam(append(scores, Tuple{}))\n}\n',
      timeoutMs: 120_000,
      expect: (r) => {
        const [first, second] = r.results;
        if (first!.status !== 'error' || first!.errorType !== 'crash')
          return `expected a crash, got ${JSON.stringify(first)}`;
        return second!.status === 'error' && second!.message?.startsWith('not run')
          ? null
          : 'expected the rest not run';
      },
    },
    {
      name: 'endless loop',
      code:
        lang === 'rust'
          ? 'pub fn best_team(scores: Vec<(char, i64)>) -> Option<(char, i64)> {\n    let mut i: u64 = 0;\n    loop {\n        i = i.wrapping_add(std::hint::black_box(1));\n        if i == 0 { return None; }\n    }\n}\n'
          : 'package main\n\nfunc bestTeam(scores []Tuple) *Tuple {\n\tfor {\n\t}\n}\n',
      timeoutMs: 2_000,
      expect: (r) =>
        r.results[0]!.status === 'timeout' ? null : `expected a timeout, got ${summary(r)}`,
    },
  ];
  for (const c of cases) {
    const where = `${lang} ${c.name}`;
    try {
      const dir = await build(lang, sig, c.code);
      const { report } = await runJob(lang, dir, jobFor(lang, meta, tests, c.code), c.timeoutMs);
      const problemText = c.expect(report);
      if (problemText) fail(where, problemText);
      else console.log(`ok   ${where}`);
      await rm(dir, { recursive: true, force: true });
    } catch (e) {
      fail(where, (e as Error).message);
    }
  }
}

// ---------------------------------------------------------- round trip

/** Each type with sample values (JSON text, so big integers stay exact). */
const ROUND_TRIP: [string, string[]][] = [
  ['int', ['0', '-1', '9223372036854775807', '-9223372036854775808']],
  ['float', ['0.1', '-2.5', '1e-7', '1e300', '3']],
  ['bool', ['true', 'false']],
  ['string', ['""', '"h\\u00e9llo"', '"tab\\t \\"q\\" \\\\ \\u0001 / \\ud83d\\ude00"', '"日本"']],
  ['char', ['"a"', '"é"', '"\\ud83d\\ude00"']],
  ['list<list<int>>', ['[]', '[[],[1,2],[3]]']],
  ['tuple<int,string,bool>', ['[1,"x",true]']],
  ['map<string,float>', ['{}', '{"a":1.5,"b":-2}']],
  ['map<int,list<char>>', ['{"-3":["x"],"7":[]}']],
  ['optional<int>', ['null', '5']],
  ['optional<list<int>>', ['null', '[]', '[1]']],
  ['tree<int>', ['[]', '[1]', '[1,null,2,3]', '[5,3,8,1,4,null,9]']],
  ['tree<string>', ['["a","b",null,"c"]']],
  ['optional<tree<int>>', ['null', '[]', '[1,2]']],
  ['list<tree<int>>', ['[[],[1,2,3]]']],
  ['linked_list<char>', ['[]', '["a","b"]']],
  ['linked_list<float>', ['[1.5,-0.25]']],
  ['map<string,optional<tuple<int,linked_list<int>>>>', ['{"k":null,"j":[1,[2,3]]}']],
];

async function checkRoundTrip(lang: Lang): Promise<void> {
  for (const [type, samples] of ROUND_TRIP) {
    const where = `${lang} echo ${type}`;
    try {
      const sig: Signature = {
        function: 'select',
        params: [{ name: 'type', type }],
        returns: type,
      };
      const body = lang === 'rust' ? 'r#type' : 'return type_';
      const code = stub(lang, sig).replace(
        lang === 'rust' ? 'todo!()' : 'panic("not implemented")',
        body,
      );
      const tests: TestCase[] = samples.map((text, i) => {
        const v = parseJson(text);
        return {
          id: `s-${i}`,
          visibility: 'visible',
          category: 'echo',
          input: { type: v },
          expected: v,
        };
      });
      const job: RunJob = {
        language: lang,
        code,
        signature: sig,
        compare: { mode: 'exact' },
        tests,
        timeLimitMs: 2000,
        memoryLimitMb: 256,
      };
      const dir = await build(lang, sig, code);
      const { report } = await runJob(lang, dir, job);
      if (!report.ok || report.results.some((r) => r.status !== 'pass'))
        fail(where, summary(report));
      else console.log(`ok   ${where}`);
      await rm(dir, { recursive: true, force: true });
    } catch (e) {
      fail(where, (e as Error).message);
    }
  }
}

// -------------------------------------------------------------- golden

async function checkGolden(lang: Lang): Promise<void> {
  const base = join(ROOT, 'packages', 'core', 'src', 'langs', 'golden', lang);
  // Any signature gives the runtime files and build command.
  const p = project(lang, { function: 'f', params: [], returns: 'int' });
  for (const name of (await readdir(base)).sort()) {
    const where = `${lang} golden ${name}`;
    const dir = await mkdtemp(join(tmpdir(), `golden-${lang}-`));
    try {
      await cp(join(base, name), dir, { recursive: true });
      for (const f of p.runtimeFiles) {
        await writeFile(join(dir, f.path), await readFile(join(RUNNERS, lang, f.from), 'utf8'));
      }
      const r = await run(p.build, dir, '', BUILD_TIMEOUT_MS);
      if (r.code !== 0) fail(where, r.stderr.slice(-3000));
      else console.log(`ok   ${where} compiles`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

// --------------------------------------------------------------- main

for (const lang of langs) {
  const tool = lang === 'rust' ? ['cargo', '--version'] : ['go', 'version'];
  const v = await run(tool, ROOT).catch(() => null);
  if (!v || v.code !== 0) {
    fail(lang, `${tool[0]} not found on PATH`);
    continue;
  }
  console.log(`---- ${v.stdout.trim()}`);
  await checkSolutions(lang);
  await checkFailures(lang);
  await checkRoundTrip(lang);
  await checkGolden(lang);
}

if (errors.length) {
  console.log(`\n${errors.length} problem(s).`);
  process.exit(1);
}
console.log('\nAll harness checks passed.');
