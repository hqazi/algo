/**
 * Past explanations of one problem, under its statement. Hidden until the
 * tutor has written one; opening one while the attempt is open counts the
 * attempt as explained, and the list says so.
 */
import { useState } from 'react';
import { ExplanationViewer } from './ExplanationViewer';
import { versionLabel } from './version';
import { useVersions } from './useVersions';

export function ExplanationList({
  slug,
  title,
  active,
  onViewed,
}: {
  slug: string;
  /** The problem's title, for the viewer's header. */
  title?: string | undefined;
  active: boolean;
  onViewed?: (marked: boolean) => void;
}) {
  const { versions } = useVersions(slug);
  const [open, setOpen] = useState<string | null>(null);

  if (!versions || versions.length === 0) return null;
  return (
    <section className="explanation-list" aria-labelledby={`expl-list-${slug}`}>
      <h2 id={`expl-list-${slug}`}>Explanations</h2>
      {active && (
        <p className="small muted">Opening one now counts this attempt as solved with help.</p>
      )}
      <ul>
        {versions.map((v) => (
          <li key={v.id}>
            <button type="button" className="link-button" onClick={() => setOpen(v.id)}>
              {versionLabel(v)}
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <ExplanationViewer
          key={open}
          slug={slug}
          title={title}
          version={open}
          onClose={() => setOpen(null)}
          {...(onViewed ? { onViewed } : {})}
        />
      )}
    </section>
  );
}
