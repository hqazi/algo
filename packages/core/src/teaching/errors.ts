/**
 * An expected failure reported to the caller (the tutor, or the UI) in words,
 * as `{ ok: false, error }`. Anything else thrown is a bug.
 * Ported from `dsa-tutor`'s `TutorError`.
 */
export class TutorError extends Error {
  /** A machine-readable reason, e.g. `not_onboarded`, `no_problem`. */
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'TutorError';
    this.code = code;
  }
}
