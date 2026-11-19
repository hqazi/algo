/**
 * The iframe policy for explanation pages (SPEC §8, §10). The page is shown
 * through `srcdoc` in an iframe with an empty `sandbox` (no scripts, opaque
 * origin, no forms, no popups, no top navigation). A CSP meta tag is added
 * too, so even a page that somehow carries markup can load nothing.
 * In-page `href="#section"` links are rewritten to `about:srcdoc#section`,
 * which scrolls within the frame instead of navigating it to the app.
 * Ported from `dsa-tutor/web/src/explanation/sandbox.ts`.
 */
export const FRAME_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
const META = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`;

/** The page ready for `srcdoc`: in-page links fixed, the CSP meta tag first in <head>. */
export function withFrameCsp(page: string): string {
  const html = page.replace(/(<a\s[^>]*?\bhref=)(["'])#/gi, '$1$2about:srcdoc#');
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head)
    return (
      html.slice(0, head.index + head[0].length) + META + html.slice(head.index + head[0].length)
    );
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return doctype[0] + META + html.slice(doctype[0].length);
  return META + html;
}
