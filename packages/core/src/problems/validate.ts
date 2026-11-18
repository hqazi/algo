/**
 * Checks across `meta.json` and `tests.json`: every test input and expected
 * value matches the signature's neutral types, the compare mode fits the
 * return type, and every listed language can run the signature.
 */
import { parseType, someType, type NeutralType } from '../types/neutral';
import { checkValue } from '../types/values';
import type { Language, Signature } from '../types/signature';
import type { ProblemMeta, TestCase } from './schema';

/** Languages with a harness, and whether it supports a type. Rust and Go arrive in T15. */
const HARNESS_SUPPORTS: Partial<Record<Language, (t: NeutralType) => boolean>> = {
  python: () => true,
};

/** True if `language` has a harness that supports every type in `sig`. */
export function languageSupports(language: Language, sig: Signature): boolean {
  const supports = HARNESS_SUPPORTS[language];
  if (!supports) return false;
  return [...sig.params.map((p) => p.type), sig.returns].every((s) => {
    const t = parseType(s);
    return !someType(t, (x) => !supports(x));
  });
}

/** Errors in a problem whose files each passed their schema. Empty when valid. */
export function crossCheckProblem(meta: ProblemMeta, tests: readonly TestCase[]): string[] {
  const errors: string[] = [];
  const sig = meta.signature;
  const returns = parseType(sig.returns);
  const params = sig.params.map((p) => ({ name: p.name, type: parseType(p.type) }));
  const names = params.map((p) => p.name);

  for (const language of meta.languages) {
    if (!languageSupports(language, sig)) {
      errors.push(
        `meta.json: languages: ${language} cannot run this signature (no harness support yet)`,
      );
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
