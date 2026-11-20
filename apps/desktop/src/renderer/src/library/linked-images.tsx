/**
 * Linked images in the reader (T23, SPEC §15.4). Main downloads and caches
 * them; the window only ever shows asset URLs. In `on-open` mode the reader
 * asks main to load them as soon as the article opens; in `ask` mode it
 * shows **Load images**. Failed downloads get **Retry**. The renderer sends
 * the article id only, never a URL.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ArticleView, ImageView } from '../../../shared/library';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';

const isRemote = (key: string): boolean => /^https:/i.test(key) || key.startsWith('//');

/** Waiting to be loaded (`remote`), or a download that failed (Retry can help). */
function counts(images: Record<string, ImageView>) {
  let pending = 0;
  let failed = 0;
  for (const [k, v] of Object.entries(images)) {
    if (!isRemote(k) || v.kind !== 'blocked') continue;
    if (v.reason === 'remote') pending += 1;
    else failed += 1;
  }
  return { pending, failed };
}

/** The article's images with linked ones as loaded so far, and the bar to load or retry them. */
export function useLinkedImages(article: ArticleView | null) {
  const app = useApp();
  // What main last answered, and for which read of the article.
  const [loaded, setLoaded] = useState<{
    article: ArticleView;
    images: Record<string, ImageView>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const images = useMemo(
    () =>
      article
        ? { ...article.images, ...(loaded?.article.id === article.id ? loaded.images : {}) }
        : {},
    [article, loaded],
  );
  // Opened with linked images not loaded yet: main is asked once (below).
  const asking = !!article && counts(article.images).pending > 0 && loaded?.article !== article;

  async function load(force: boolean, retry: boolean): Promise<void> {
    if (!article) return;
    setBusy(true);
    try {
      const r = await invoke('library:load-images', { id: article.id, force, retry });
      setLoaded({ article, images: r.images });
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!article || counts(article.images).pending === 0) return;
    let live = true;
    invoke('library:load-images', { id: article.id, force: false, retry: false }).then(
      (r) => live && setLoaded({ article, images: r.images }),
      (e: unknown) => {
        if (!live) return;
        setLoaded({ article, images: {} });
        app.notify(errorText(e), 'error');
      },
    );
    return () => {
      live = false;
    };
    // Once per read of the article.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article]);

  const { pending, failed } = counts(images);
  const plural = (n: number) => `${n} linked image${n === 1 ? '' : 's'}`;
  const bar =
    pending + failed === 0 && !busy && !asking ? null : (
      <p className="notice small images-bar" role="status" data-testid="images-bar">
        {busy || asking ? (
          'Loading images…'
        ) : (
          <>
            {pending > 0 && (
              <>
                {plural(pending)} not loaded.{' '}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void load(true, false)}
                >
                  Load images
                </button>{' '}
              </>
            )}
            {failed > 0 && (
              <>
                {plural(failed)} could not be loaded.{' '}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void load(true, true)}
                >
                  Retry
                </button>
              </>
            )}
          </>
        )}
      </p>
    );
  return { images, bar };
}
