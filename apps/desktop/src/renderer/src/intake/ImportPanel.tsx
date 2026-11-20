/**
 * Import mode of the New Problem dialog (ported from
 * `dsa-tutor/web/src/intake/ImportPanel.tsx`): pick an entry from an open
 * problem set. The set's licence and attribution are shown here and, once
 * imported, under the problem's title. Listing needs no network; the main
 * process fetches the entry when the import starts.
 */
import { useEffect, useMemo, useState } from 'react';
import type { OpenSetEntryView, OpenSetView } from '../../../shared/intake';
import { invoke } from '../ipc';
import { errorText } from '../lib/app-context';

export const IMPORT_NOTE =
  'Imported problems come from open problem sets whose licence permits reuse; the licence and ' +
  'attribution are kept with the problem and shown under its title.';

export interface ImportChoice {
  set: string;
  entry: string;
}

export interface ImportPanelProps {
  value: ImportChoice | null;
  onChange: (choice: ImportChoice | null) => void;
  topics: { id: string; name: string }[];
}

export function ImportPanel({ value, onChange, topics }: ImportPanelProps) {
  const [sets, setSets] = useState<OpenSetView[] | null>(null);
  const [setId, setSetId] = useState<string>(value?.set ?? '');
  const [loaded, setLoaded] = useState<{ set: string; entries: OpenSetEntryView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let live = true;
    invoke('open-sets:list')
      .then((r) => {
        if (!live) return;
        setSets(r.sets);
        setSetId((s) => s || r.sets[0]?.id || '');
      })
      .catch((e: unknown) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!setId) return;
    let live = true;
    invoke('open-sets:entries', { set: setId })
      .then((r) => live && setLoaded({ set: setId, entries: r.entries }))
      .catch((e: unknown) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [setId]);

  const entries = loaded?.set === setId ? loaded.entries : null;
  const topicName = useMemo(() => new Map(topics.map((t) => [t.id, t.name])), [topics]);
  const current = sets?.find((s) => s.id === setId) ?? null;
  const q = filter.trim().toLowerCase();
  const shown = (entries ?? []).filter(
    (e) =>
      !q ||
      e.title.toLowerCase().includes(q) ||
      e.blurb.toLowerCase().includes(q) ||
      (topicName.get(e.topic) ?? e.topic).toLowerCase().includes(q),
  );

  return (
    <div role="tabpanel" id="np-panel" aria-label="Import">
      <p className="muted small" data-testid="import-note">
        {IMPORT_NOTE}
      </p>
      {error && (
        <p className="error-text small" role="alert">
          Could not load the open sets: {error}
        </p>
      )}
      {sets && sets.length > 1 && (
        <label className="field">
          Open set
          <select
            value={setId}
            onChange={(e) => {
              setSetId(e.target.value);
              onChange(null);
            }}
          >
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {current && (
        <p className="import-licence small" data-testid="import-licence">
          {current.name} ({current.url.replace(/^https:\/\//, '')}) · {current.license} ·{' '}
          {current.attribution}
        </p>
      )}
      <label className="field">
        Search
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="title, topic or words"
        />
      </label>
      {!entries && !error && <p className="muted small">Loading…</p>}
      {entries && (
        <ul className="import-entries" aria-label="Problems in the set">
          {shown.map((e) => {
            const selected = value?.set === setId && value.entry === e.id;
            return (
              <li key={e.id}>
                <label className={selected ? 'import-entry selected' : 'import-entry'}>
                  <input
                    type="radio"
                    name="import-entry"
                    value={e.id}
                    checked={selected}
                    onChange={() => onChange({ set: setId, entry: e.id })}
                  />
                  <span>
                    <strong>{e.title}</strong>
                    <span className="muted small">
                      {' '}
                      · {topicName.get(e.topic) ?? e.topic} · {e.difficulty}
                      {e.imported ? (
                        <>
                          {' '}
                          · imported as <code>{e.imported}</code>
                        </>
                      ) : null}
                    </span>
                    {e.blurb && <span className="small import-blurb">{e.blurb}</span>}
                  </span>
                </label>
              </li>
            );
          })}
          {shown.length === 0 && <li className="muted small">No problem matches “{filter}”.</li>}
        </ul>
      )}
    </div>
  );
}
