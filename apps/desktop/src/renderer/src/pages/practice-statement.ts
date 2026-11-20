/** Helpers for the Practice page's statement (kept apart from components for fast refresh). */

/**
 * Splits a statement into its body and its "## Constraints" section (shown in
 * the quiet Details block); `constraints` is null when there is none.
 */
export function splitConstraints(md: string): { body: string; constraints: string | null } {
  const m = /^##\s+Constraints\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(md);
  if (!m) return { body: md, constraints: null };
  const constraints = m[1]!.trim();
  const body = (md.slice(0, m.index) + md.slice(m.index + m[0].length)).trimEnd() + '\n';
  return { body, constraints: constraints || null };
}
