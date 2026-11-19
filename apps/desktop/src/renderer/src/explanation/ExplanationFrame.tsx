/**
 * One explanation page in a sandboxed iframe (SPEC §8, §10): the HTML comes
 * from main over IPC and is shown through `srcdoc` with an empty `sandbox`.
 * Once shown, an open attempt is told the explanation was seen.
 */
import { useEffect, useState } from 'react';
import { invoke } from '../ipc';
import { errorText } from '../lib/app-context';
import { withFrameCsp } from './sandbox';

export function ExplanationFrame({
  slug,
  version,
  onViewed,
}: {
  slug: string;
  version?: string | null;
  onViewed?: (marked: boolean) => void;
}) {
  const key = `${slug}@${version ?? 'latest'}`;
  const [loaded, setLoaded] = useState<{ key: string; html?: string; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    invoke('explanations:page', { slug, ...(version ? { version } : {}) }).then(
      (r) => {
        if (!live) return;
        setLoaded({ key, html: r.html });
        invoke('explanations:viewed', { slug }).then(
          (v) => {
            if (live) onViewed?.(v.attempt_marked_explained);
          },
          () => undefined,
        );
      },
      (e: unknown) => {
        if (live) setLoaded({ key, error: errorText(e) });
      },
    );
    return () => {
      live = false;
    };
    // onViewed is a notification only; a new function must not reload the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, version, key]);

  const current = loaded?.key === key ? loaded : null;
  const error = current?.error ?? null;
  const html = current?.html ?? null;
  if (error)
    return (
      <p className="error-text" role="alert">
        Could not open the explanation: {error}
      </p>
    );
  if (html === null) return <p className="muted">Loading…</p>;
  return (
    <iframe
      className="explanation-frame"
      title={`Explanation for ${slug}`}
      sandbox=""
      srcDoc={withFrameCsp(html)}
      referrerPolicy="no-referrer"
      data-testid="explanation-frame"
    />
  );
}
