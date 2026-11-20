/**
 * Article Markdown for the reader (T22, SPEC §15.2). Untrusted text, in the
 * same two layers as chat (`lib/markdown.ts`): `marked` with raw HTML
 * dropped (D-40), then DOMPurify with the chat allowlist plus `img` only.
 *
 * - An `img` survives only if its `src` is an app asset URL
 *   (`tutor-app://app/library-asset/<token>`, given by main per reference);
 *   any other image becomes a placeholder with its alt text and host.
 * - Obsidian syntax: `![[file.png]]` / `![[file.png|300]]` images,
 *   `[[note]]` / `[[note|label]]` / `[[note#heading]]` links (to a library
 *   article, else plain text), `> [!note]` callouts, note embeds as links.
 * - Links keep only `https:`, `http:`, `mailto:` and in-app `#/library/<id>`;
 *   the reader opens web links through main, in the system browser.
 */
import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';
import {
  IMAGE_FILE,
  refKey,
  wikiTarget,
  type ImageReason,
  type ImageView,
} from '../../../shared/library';
import { ALLOWED_ATTR, ALLOWED_TAGS } from '../lib/markdown';

export interface ArticleRefs {
  images: Record<string, ImageView>;
  links: Record<string, string | null>;
}

export const REASON_TEXT: Record<ImageReason, string> = {
  remote: 'linked image, not downloaded',
  insecure: 'not loaded: insecure link',
  data: 'embedded image not shown',
  scheme: 'not loaded: unsupported link',
  outside: 'outside the library folder',
  not_found: 'image not found',
  not_image: 'not an image file',
  svg: 'SVG images are not shown',
  too_large: 'image over 25 MB',
  local_address: 'not loaded: local network address',
  port: 'not loaded: only the standard https port',
  redirects: 'not loaded: too many redirects',
  oversize: 'not loaded: image too large',
  timeout: 'not loaded: took too long',
  pixels: 'not loaded: image dimensions too large',
  http: 'not loaded: the site answered with an error',
  network: 'not loaded: could not reach the site',
  limit: 'not loaded: too many images in this article',
};

const ASSET_SRC = /^tutor-app:\/\/app\/library-asset\/[A-Za-z0-9_-]+$/;
const LINK_HREF = /^(?:https?:|mailto:|#\/library\/)/i;

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]!);

function placeholder(alt: string, view: ImageView | undefined): string {
  const reason: ImageReason = view?.kind === 'blocked' ? view.reason : 'not_found';
  const host = view?.kind === 'blocked' && view.host ? ` · ${esc(view.host)}` : '';
  const text = REASON_TEXT[reason];
  return (
    `<span class="img-placeholder" title="${esc(text)}">` +
    `<span class="img-alt">${esc(alt || 'Image')}${host}</span> ` +
    `<span class="small">(${esc(text)})</span></span>`
  );
}

function image(ref: string, alt: string, refs: ArticleRefs, size: string | null = null): string {
  const view = refs.images[refKey(ref)];
  if (view?.kind !== 'asset' || !ASSET_SRC.test(view.url)) return placeholder(alt, view);
  const width = size ? /^(\d{1,4})(?:x\d{1,4})?$/.exec(size)?.[1] : undefined;
  return `<img src="${esc(view.url)}" alt="${esc(alt)}"${width ? ` width="${width}"` : ''}>`;
}

function wikiLink(inner: string, refs: ArticleRefs, embed = false): string {
  const { target, heading, label } = wikiTarget(inner);
  const text = label ?? (target ? (heading ? `${target} › ${heading}` : target) : (heading ?? ''));
  const id = target ? refs.links[target] : null;
  const cls = embed ? 'wikilink embed' : 'wikilink';
  return id
    ? `<a href="#/library/${encodeURIComponent(id)}" class="${cls}">${esc(text)}</a>`
    : `<span class="${cls} unresolved">${esc(text)}</span>`;
}

function markedFor(refs: ArticleRefs): Marked {
  return new Marked({
    gfm: true,
    breaks: false,
    async: false,
    extensions: [
      {
        name: 'wikiEmbed',
        level: 'inline',
        start: (src: string) => {
          const i = src.indexOf('![[');
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = /^!\[\[([^[\]\n]+)\]\]/.exec(src);
          return m ? { type: 'wikiEmbed', raw: m[0], inner: m[1]! } : undefined;
        },
        renderer(token) {
          const inner = (token as unknown as { inner: string }).inner;
          const { target, label } = wikiTarget(inner);
          return IMAGE_FILE.test(target)
            ? image(target, target.split('/').pop() ?? target, refs, label)
            : wikiLink(inner, refs, true);
        },
      },
      {
        name: 'wikiLink',
        level: 'inline',
        start: (src: string) => {
          const i = src.indexOf('[[');
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = /^\[\[([^[\]\n]+)\]\]/.exec(src);
          return m ? { type: 'wikiLink', raw: m[0], inner: m[1]! } : undefined;
        },
        renderer(token) {
          return wikiLink((token as unknown as { inner: string }).inner, refs);
        },
      },
    ],
    renderer: {
      // Raw HTML in notes is dropped (D-40).
      html() {
        return '';
      },
      image({ href, text }: Tokens.Image) {
        return image(href, text, refs);
      },
      blockquote({ tokens }: Tokens.Blockquote) {
        const body = this.parser.parse(tokens);
        const m = /^<p>\[!([A-Za-z][\w-]*)\][+-]?[ \t]*([^\n]*?)(\n|<\/p>\n?)/.exec(body);
        if (!m) return `<blockquote>\n${body}</blockquote>\n`;
        const type = m[1]!.toLowerCase();
        const title = m[2] || type.charAt(0).toUpperCase() + type.slice(1);
        const rest = m[3] === '\n' ? `<p>${body.slice(m[0].length)}` : body.slice(m[0].length);
        return (
          `<blockquote class="callout callout-${type}">` +
          `<p class="callout-title">${title}</p>\n${rest}</blockquote>\n`
        );
      },
    },
  });
}

// Its own DOMPurify instance: these hooks never touch chat sanitising.
const purifier = DOMPurify(window);
purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? '';
    if (!LINK_HREF.test(href)) node.removeAttribute('href');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  } else if (node.tagName === 'IMG') {
    const src = node.getAttribute('src') ?? '';
    if (!ASSET_SRC.test(src)) {
      const span = node.ownerDocument.createElement('span');
      span.className = 'img-placeholder';
      span.textContent = `${node.getAttribute('alt') || 'Image'} (not shown)`;
      node.replaceWith(span);
      return;
    }
    const w = node.getAttribute('width');
    if (w !== null && !/^\d{1,4}$/.test(w)) node.removeAttribute('width');
  }
});

/** The second layer: the chat allowlist plus `img` (asset URLs only). */
export function sanitizeArticle(html: string): string {
  return purifier.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS, 'img'],
    ALLOWED_ATTR: [...ALLOWED_ATTR, 'rel', 'src', 'alt', 'width'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#\/library\/|tutor-app:\/\/app\/library-asset\/)/i,
    // Not a URL: without this DOMPurify tests it against the regexp above.
    ADD_URI_SAFE_ATTR: ['width'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

export function renderArticle(body: string, refs: ArticleRefs): string {
  return sanitizeArticle(markedFor(refs).parse(body) as string);
}
