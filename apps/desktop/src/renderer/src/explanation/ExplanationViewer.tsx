/**
 * The explanation panel: a dialog over the app with the page in a sandboxed
 * iframe and a picker for earlier versions. Ported from
 * `dsa-tutor/web/src/explanation/ExplanationViewer.tsx` (no "open in new
 * tab": the app has one window). Callers key it by slug and version, so a
 * new one starts afresh.
 */
import { useEffect, useState } from 'react';
import type { ExplanationVersionView } from '../../../shared/tutor';
import { ExplanationFrame } from './ExplanationFrame';
import { versionLabel } from './version';
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
    <select
      className="explanation-version small"
      value={value ?? versions[0]!.id}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Explanation version"
    >
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          {versionLabel(v)}
        </option>
      ))}
    </select>
  );
}

export function ExplanationViewer({
  slug,
  version: initial = null,
  onClose,
  onViewed,
}: {
  slug: string;
  version?: string | null;
  onClose: () => void;
  onViewed?: (marked: boolean) => void;
}) {
  const [version, setVersion] = useState<string | null>(initial);
  const { versions } = useVersions(slug);

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
          <h2 id="expl-title">Explanation: {slug}</h2>
          <span className="spacer" />
          {versions && <VersionPicker versions={versions} value={version} onChange={setVersion} />}
          <button type="button" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <ExplanationFrame slug={slug} version={shown} {...(onViewed ? { onViewed } : {})} />
      </div>
    </div>
  );
}
