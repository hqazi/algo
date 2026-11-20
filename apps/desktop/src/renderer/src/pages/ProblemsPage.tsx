/**
 * Problems (T31, docs/design.md → Problems): search and filter the whole
 * list, with counts in the filters; rows open the problem on click, and the
 * title is a real link for the keyboard. Filtering happens here, on the full
 * list, so each filter can show how many problems each choice leaves.
 */
import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react';
import { Search, X } from 'lucide-react';
import {
  PROBLEM_STATUSES,
  type ProblemFilters,
  type ProblemListItem,
} from '../../../shared/practice';
import { invoke } from '../ipc';
import { Link } from '../components/Link';
import { Button, Select } from '../components/ui';
import { errorText, useApp } from '../lib/app-context';
import { PROBLEM_STATUS_LABEL, titleCase } from '../lib/format';
import { useStored } from '../lib/hooks';
import { navigate } from '../lib/router';
import { countBy, matching } from './dashboard';
import { DifficultyDot, StatusIcon } from './problem-bits';
import './problems.css';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const SOURCES = ['curated', 'generated', 'pasted', 'imported'] as const;
type Key = keyof ProblemFilters;

export function ProblemsPage() {
  const { topics, topicName, version } = useApp();
  const [filters, setFilters] = useStored<ProblemFilters>('problem-filters', {});
  const [items, setItems] = useState<ProblemListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    invoke('problems:list', {})
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
  }, [version]);

  const all = useMemo(() => items ?? [], [items]);
  const q = search.trim().toLowerCase();
  const searched = useMemo(
    () => all.filter((p) => !q || p.title.toLowerCase().includes(q) || p.slug.includes(q)),
    [all, q],
  );
  const shown = matching(searched, filters);
  const counts = (k: Key) => countBy(matching(searched, filters, k), k);
  const sources = new Set(all.map((p) => p.source));
  const showSource = sources.size > 1;

  const set = (k: Key) => (e: ChangeEvent<HTMLSelectElement>) =>
    setFilters({ ...filters, [k]: e.target.value || undefined });
  const filtered = Object.values(filters).some(Boolean);

  const filter = (
    k: Key,
    label: string,
    any: string,
    values: readonly string[],
    name: (v: string) => string,
  ) => {
    const c = counts(k);
    return (
      <Select value={filters[k] ?? ''} onChange={set(k)} aria-label={label}>
        <option value="">{any}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {name(v)} ({c.get(v) ?? 0})
          </option>
        ))}
      </Select>
    );
  };

  const open = (slug: string) => (e: MouseEvent<HTMLTableRowElement>) => {
    // The title link navigates itself; a selection drag is not a click.
    if ((e.target as Element).closest('a') || getSelection()?.toString()) return;
    navigate(`/p/${slug}`);
  };

  return (
    <main className="page problems-page">
      <h1>Problems</h1>
      <div className="problems-toolbar" role="search">
        <label className="problems-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Search titles"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search titles"
          />
        </label>
        {filter(
          'topic',
          'Topic',
          'All topics',
          topics.map((t) => t.id),
          topicName,
        )}
        {filter('difficulty', 'Difficulty', 'Any difficulty', DIFFICULTIES, titleCase)}
        {(showSource || filters.source) &&
          filter(
            'source',
            'Source',
            'Any source',
            SOURCES.filter((s) => sources.has(s) || filters.source === s),
            titleCase,
          )}
        {filter(
          'status',
          'Status',
          'Any status',
          PROBLEM_STATUSES,
          (s) => PROBLEM_STATUS_LABEL[s] ?? s,
        )}
        {filtered && (
          <Button variant="ghost" icon={<X aria-hidden="true" />} onClick={() => setFilters({})}>
            Clear
          </Button>
        )}
        <span className="problems-count muted small" aria-live="polite">
          {items !== null && `${shown.length} problem${shown.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {error && <p className="error-text">{error}</p>}
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <table className="problems-table">
            <thead>
              <tr>
                <th className="col-status">
                  <span className="sr-only">Status</span>
                </th>
                <th>Title</th>
                <th>Topic</th>
                <th>Difficulty</th>
                {showSource && <th>Source</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.slug} onClick={open(p.slug)}>
                  <td className="col-status">
                    <StatusIcon status={p.status} />
                  </td>
                  <td className="col-title">
                    <Link to={`/p/${p.slug}`}>{p.title}</Link>
                  </td>
                  <td className="muted">{topicName(p.topic)}</td>
                  <td>
                    <DifficultyDot difficulty={p.difficulty} />
                  </td>
                  {showSource && <td className="muted">{titleCase(p.source)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && (
            <div className="problems-empty">
              <Search size={20} aria-hidden="true" />
              <p>No problems match {filtered || q ? 'these filters' : 'yet'}.</p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
