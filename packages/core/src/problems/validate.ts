/**
 * Checks across `meta.json` and `tests.json`: every test input and expected
 * value matches the signature's neutral types, the compare mode fits the
 * return type, and every listed language can run the signature.
 */
import { goUnsupported } from '../langs/go';
import { rustUnsupported } from '../langs/rust';
import { parseType, someType } from '../types/neutral';
import { checkValue } from '../types/values';
import type { Language, Signature } from '../types/signature';
import type { ProblemMeta, TestCase } from './schema';

/**
 * Languages with a harness, and why one cannot run a signature (`null` when
 * it can). Python runs everything; Rust and Go need one node element type
 * per signature (T15, DECISIONS D-29).
 */
const HARNESS_LIMIT: Record<Language, (sig: Signature) => string | null> = {
  python: () => null,
  rust: rustUnsupported,
  go: goUnsupported,
};

/**
 * Languages the app can run solutions in: what profiles, the tutor's tools
 * and new problems may use. Python runs in Pyodide; Rust and Go with the
 * user's own `cargo` / `go` (T16), which may be missing: a run then reports
 * `runtime-missing` and says what to install.
 */
const RUNNABLE: readonly Language[] = ['python', 'rust', 'go'];

export function languagesWithHarness(): Language[] {
  return [...RUNNABLE];
}

/** True if `language` has a harness that supports every type in `sig`. */
export function languageSupports(language: Language, sig: Signature): boolean {
  const limit = HARNESS_LIMIT[language];
  return limit !== undefined && limit(sig) === null;
}

/** Errors in a problem whose files each passed their schema. Empty when valid. */
export function crossCheckProblem(meta: ProblemMeta, tests: readonly TestCase[]): string[] {
  const errors: string[] = [];
  const sig = meta.signature;
  const returns = parseType(sig.returns);
  const params = sig.params.map((p) => ({ name: p.name, type: parseType(p.type) }));
  const names = params.map((p) => p.name);

  for (const language of meta.languages) {
    const limit = HARNESS_LIMIT[language](sig);
    if (limit !== null) {
      errors.push(`meta.json: languages: ${language} cannot run this signature (${limit})`);
    }
  }

  const mode = meta.compare.mode;
  if ((mode === 'unordered' || mode === 'unordered_deep') && returns.kind !== 'list') {
    errors.push(`meta.json: compare: mode ${mode} needs a list return type, not ${sig.returns}`);
  }
  if (mode === 'float' && !someType(returns, (t) => t.kind === 'float')) {
    errors.push(
      `meta.json: compare: mode float needs a float in the return type, not ${sig.returns}`,
    );
  }

  tests.forEach((test, i) => {
    const where = `tests.json: tests[${i}] (${test.id})`;
    const keys = Object.keys(test.input);
    const missing = names.filter((n) => !keys.includes(n));
    const extra = keys.filter((k) => !names.includes(k));
    if (missing.length || extra.length) {
      const parts = [
        missing.length ? `missing ${missing.join(', ')}` : '',
        extra.length ? `unexpected ${extra.join(', ')}` : '',
      ].filter(Boolean);
      errors.push(
        `${where}: input must have exactly the parameters ${names.join(', ') || '(none)'}: ${parts.join('; ')}`,
      );
    }
    for (const p of params) {
      if (Object.hasOwn(test.input, p.name)) {
        for (const e of checkValue(test.input[p.name], p.type, `input.${p.name}`))
          errors.push(`${where}: ${e}`);
      }
    }
    for (const e of checkValue(test.expected, returns, 'expected', { canonical: true })) {
      errors.push(`${where}: ${e}`);
    }
  });

  return errors;
}
