import { useEffect, useState } from 'react';
/** Problems (ported from `dsa-tutor/web`): browse and filter by topic, difficulty, source, status. */
import type { ChangeEvent } from 'react';
import type { ProblemFilters, ProblemListItem } from '../../../shared/practice';
import { invoke } from '../ipc';
import { Link } from '../components/Link';
import { errorText, useApp } from '../lib/app-context';
import { PROBLEM_STATUS_LABEL, titleCase } from '../lib/format';
import { useStored } from '../lib/hooks';

export function ProblemsPage() {
  const { topics, topicName, version } = useApp();
  const [filters, setFilters] = useStored<ProblemFilters>('problem-filters', {});
  const [items, setItems] = useState<ProblemListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    invoke('problems:list', filters)
      .then((r) => {
        if (cancelled) return;
        setItems(r.problems);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(errorText(e));
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, version]);

  const set = (k: keyof ProblemFilters) => (e: ChangeEvent<HTMLSelectElement>) =>
    setFilters({ ...filters, [k]: e.target.value || undefined });
  const q = search.trim().toLowerCase();
  const shown = (items ?? []).filter(
    (p) => !q || p.title.toLowerCase().includes(q) || p.slug.includes(q),
  );

  return (
    <main className="page">
      <h1>Problems</h1>
      <div className="filters" role="search">
        <input
          type="search"
          placeholder="Search titles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search titles"
        />
        <select value={filters.topic ?? ''} onChange={set('topic')} aria-label="Topic">
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={filters.difficulty ?? ''}
          onChange={set('difficulty')}
          aria-label="Difficulty"
        >
          <option value="">Any difficulty</option>
          {['easy', 'medium', 'hard'].map((d) => (
            <option key={d} value={d}>
              {titleCase(d)}
            </option>
          ))}
        </select>
        <select value={filters.source ?? ''} onChange={set('source')} aria-label="Source">
          <option value="">Any source</option>
          {['curated', 'generated', 'pasted', 'imported'].map((d) => (
            <option key={d} value={d}>
              {titleCase(d)}
            </option>
          ))}
        </select>
        <select value={filters.status ?? ''} onChange={set('status')} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(PROBLEM_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {Object.values(filters).some(Boolean) && (
          <button type="button" onClick={() => setFilters({})}>
            Clear
          </button>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p className="muted small">
            {shown.length} problem{shown.length === 1 ? '' : 's'}
          </p>
          <table className="problem-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Topic</th>
                <th>Difficulty</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.slug}>
                  <td>
                    <Link to={`/p/${p.slug}`}>{p.title}</Link>
                  </td>
                  <td>{topicName(p.topic)}</td>
                  <td>
                    <span className={`pill diff-${p.difficulty}`}>{titleCase(p.difficulty)}</span>
                  </td>
                  <td>{titleCase(p.source)}</td>
                  <td>
                    <span className={`pill status-${p.status}`}>
                      {PROBLEM_STATUS_LABEL[p.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="muted">No problems match these filters.</p>}
        </>
      )}
    </main>
  );
}
