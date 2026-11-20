/**
 * The reader (T22, SPEC §15.2, §15.6): an article's header from its
 * frontmatter, then the body through the article sanitiser. Needs no key
 * and no network: main reads the file and gives asset URLs for its local
 * images. Links never navigate the window: library links change the route,
 * web and mail links go to main, which opens them in the system browser.
 * Restyled in T32 (docs/design.md → Library): the source as its domain with
 * an external-link icon (the full URL in the tooltip), tags as pills.
 */
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { ExternalLink, FileWarning, Sparkles } from 'lucide-react';
import type { ArticleView } from '../../../shared/library';
import { Badge } from '../components/ui';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { navigate } from '../lib/router';
import { renderArticle } from './article-markdown';
import { sourceLabel } from './source-label';
import { useLinkedImages } from './linked-images';

const WEB = /^(?:https?:|mailto:)/i;

export interface ReaderProps {
  id: string;
  version?: number;
  /** T24: drawn over the reader (margin markers), given the rendered body. */
  layer?: (body: HTMLElement | null, html: string) => ReactNode;
  /** T24: the article as loaded (`null` while loading or on error). */
  onArticle?: (article: ArticleView | null) => void;
}

export function Reader({ id, version = 0, layer, onArticle }: ReaderProps) {
  const app = useApp();
  const [article, setArticle] = useState<ArticleView | null>(null);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    invoke('library:article', { id }).then(
      (a) => {
        if (!live) return;
        setArticle(a);
        setError(null);
      },
      (e: unknown) => {
        if (!live) return;
        setArticle(null);
        setError(errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [id, version]);

  const linked = useLinkedImages(article);
  const images = linked.images;
  const html = useMemo(
    () => (article ? renderArticle(article.body, { images, links: article.links }) : ''),
    [article, images],
  );
  useEffect(
    () => onArticle?.(article && article.id === id ? article : null),
    [article, id, onArticle],
  );

  function openLink(href: string): void {
    void invoke('library:open-link', { url: href }).catch((e: unknown) =>
      app.notify(errorText(e), 'error'),
    );
  }

  function onClick(e: MouseEvent<HTMLElement>): void {
    const a = (e.target as Element).closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#/library/')) navigate(href.slice(1));
    else if (WEB.test(href)) openLink(href);
  }

  if (error)
    return (
      <p className="error-text reader-pad" role="alert">
        {error}
      </p>
    );
  if (!article || article.id !== id) return <p className="muted reader-pad">Loading…</p>;

  const dates = [
    article.published && `Published ${article.published}`,
    article.created && `Saved ${article.created}`,
  ].filter(Boolean);

  return (
    <article className="reader" aria-label={article.title} onClick={onClick}>
      {article.missing && (
        <p className="notice reader-missing" role="status" data-testid="file-missing">
          <FileWarning size={16} aria-hidden="true" />
          <span>The file is missing. It may have been moved or deleted outside the app.</span>
        </p>
      )}
      <header className="reader-header">
        <h1>{article.title}</h1>
        {article.generated && (
          <p className="small reader-ai" data-testid="ai-written">
            <Badge tone="accent">
              <Sparkles size={12} aria-hidden="true" />
              AI-written
            </Badge>{' '}
            <span className="muted">Written by the tutor; check it before you rely on it.</span>
          </p>
        )}
        {article.source && WEB.test(article.source) && (
          <p className="small reader-source">
            <a
              href={article.source}
              rel="noopener noreferrer nofollow"
              title={article.source}
              data-testid="source-link"
            >
              <span>{sourceLabel(article.source)}</span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </p>
        )}
        {(article.author.length > 0 || dates.length > 0) && (
          <p className="small muted reader-meta">
            {article.author.length > 0 && <>By {article.author.join(', ')}</>}
            {article.author.length > 0 && dates.length > 0 && ' · '}
            {dates.join(' · ')}
          </p>
        )}
        {article.description && <p className="reader-description">{article.description}</p>}
        {article.tags.length > 0 && (
          <p className="reader-tags">
            {article.tags.map((t) => (
              <Badge key={t} className="reader-tag">
                #{t}
              </Badge>
            ))}
          </p>
        )}
        {article.extra.length > 0 && (
          <details className="small reader-props">
            <summary>Other properties</summary>
            <dl className="reader-extra">
              {article.extra.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </header>
      {linked.bar}
      <div className="md article-body" ref={setBody} dangerouslySetInnerHTML={{ __html: html }} />
      {layer?.(body, html)}
    </article>
  );
}
