/**
 * The explanation panel: a dialog over the app with the page in a sandboxed
 * iframe and a picker for earlier versions. Ported from
 * `dsa-tutor/web/src/explanation/ExplanationViewer.tsx` (no "open in new
 * tab": the app has one window). Callers key it by slug and version, so a
 * new one starts afresh. The header names the problem by its title (T30),
 * given or looked up, and falls back to the slug.
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ExplanationVersionView } from '../../../shared/tutor';
import { IconButton, Select } from '../components/ui';
import { invoke } from '../ipc';
import { ExplanationFrame } from './ExplanationFrame';
import { versionLabel, versionTitle } from './version';
import { useVersions } from './useVersions';
import './explanation.css';

export function VersionPicker({
  versions,
  value,
  onChange,
}: {
  versions: ExplanationVersionView[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (versions.length < 2) return null;
  return (
    <Select
      wrapperClassName="explanation-version"
      value={value ?? versions[0]!.id}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Explanation version"
    >
      {versions.map((v) => (
        <option key={v.id} value={v.id} title={versionTitle(v)}>
          {versionLabel(v)}
        </option>
      ))}
    </Select>
  );
}

export function ExplanationViewer({
  slug,
  title: given,
  version: initial = null,
  onClose,
  onViewed,
}: {
  slug: string;
  /** The problem's title; looked up from the slug when not given. */
  title?: string | undefined;
  version?: string | null;
  onClose: () => void;
  onViewed?: (marked: boolean) => void;
}) {
  const [version, setVersion] = useState<string | null>(initial);
  const { versions } = useVersions(slug);
  const [found, setFound] = useState<string | null>(null);

  useEffect(() => {
    if (given) return;
    let live = true;
    invoke('problems:get', { slug }).then(
      (d) => {
        if (live && d.meta.title) setFound(d.meta.title);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [slug, given]);
  const title = given || found || slug;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The newest version is the latest page: ask for it without an id.
  const shown = version && versions && versions[0]?.id === version ? null : version;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal wide explanation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expl-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="explanation-head">
          <div className="explanation-titles">
            <span className="section-label">Explanation</span>
            <h2 id="expl-title">{title}</h2>
          </div>
          <span className="spacer" />
          {versions && <VersionPicker versions={versions} value={version} onChange={setVersion} />}
          <IconButton
            aria-label="Close"
            icon={<X aria-hidden="true" />}
            onClick={onClose}
            autoFocus
          />
        </div>
        <ExplanationFrame slug={slug} version={shown} {...(onViewed ? { onViewed } : {})} />
      </div>
    </div>
  );
}
