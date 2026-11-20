/**
 * Progress (T31, docs/design.md → Progress): stat tiles, then the topics by
 * group, each topic one compact row with a segmented bar (unaided / with
 * help / tried), then the problems in progress and the recent attempts.
 */
import { useEffect, useState } from 'react';
import type { AttemptView, StatusResponse, TopicView } from '../../../shared/practice';
import { Link } from '../components/Link';
import { Badge, type BadgeTone } from '../components/ui';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { OUTCOME_LABEL, titleCase, when } from '../lib/format';
import { levelCounts, topicParts } from './dashboard';
import './progress.css';

const COMFORTABLE_AFTER = 3;
/** Group names as `dsa-tutor`'s profile form showed them (T09 moves them next to the questions). */
const GROUP_NAMES: Record<string, string> = {
  basics: 'Basics',
  linear: 'Linear',
  'search-sort': 'Search & sort',
  'trees-graphs': 'Trees & graphs',
  'recursion-dp': 'Recursion & DP',
};
const LEVEL_TONE: Record<TopicView['level'], BadgeTone> = {
  new: 'neutral',
  learning: 'warn',
  comfortable: 'pass',
};
const OUTCOME_TONE: Record<string, BadgeTone> = {
  unaided: 'pass',
  with_hints: 'warn',
  gave_up: 'fail',
};

function TopicRow({ t }: { t: TopicView }) {
  const p = topicParts(t);
  // The bar's length is the 3 unaided solves that make a topic comfortable, or more if tried more.
  const scale = Math.max(COMFORTABLE_AFTER, t.attempted);
  const pct = (n: number) => `${(n / scale) * 100}%`;
  const label =
    `${t.name}: ${Math.min(t.solved_unaided, COMFORTABLE_AFTER)} of ${COMFORTABLE_AFTER} ` +
    `unaided solves${p.text ? ` (${p.text})` : ''}`;
  return (
    <li className="topic-row" data-testid={`topic-${t.id}`}>
      <span className="topic-row-name">{t.name}</span>
      <Badge tone={LEVEL_TONE[t.level]}>{titleCase(t.level)}</Badge>
      <span className="topic-bar" role="img" aria-label={label}>
        {p.unaided > 0 && <span className="seg seg-unaided" style={{ width: pct(p.unaided) }} />}
        {p.helped > 0 && <span className="seg seg-helped" style={{ width: pct(p.helped) }} />}
        {p.tried > 0 && <span className="seg seg-tried" style={{ width: pct(p.tried) }} />}
      </span>
      <span className="topic-counts" data-testid="topic-counts">
        {p.text}
      </span>
    </li>
  );
}

function Tile(props: { label: string; value: number; sub: string; tone?: 'pass' | 'warn' }) {
  return (
    <div className={props.tone ? `stat-tile stat-${props.tone}` : 'stat-tile'}>
      <dt>{props.label}</dt>
      <dd>
        <span className="stat-value">{props.value}</span>{' '}
        <span className="stat-sub">{props.sub}</span>
      </dd>
    </div>
  );
}

export function ProgressPage() {
  const { topics, version, topicName, refresh } = useApp();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [attempts, setAttempts] = useState<AttemptView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    Promise.all([invoke('status:get'), invoke('attempts:list', { last: 20 })])
      .then(([s, a]) => {
        setStatus(s);
        setAttempts(a.attempts);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [version]);

  const groups = [...new Set(topics.map((t) => t.group))];
  const counts = levelCounts(topics);
  const of = `of ${topics.length} topics`;

  return (
    <main className="page progress-page">
      <h1>Progress</h1>
      {error && <p className="error-text">{error}</p>}
      <dl className="stat-tiles">
        <Tile label="Comfortable" value={counts.comfortable} sub={of} tone="pass" />
        <Tile label="Learning" value={counts.learning} sub={of} tone="warn" />
        <Tile label="Not started" value={counts.new} sub={of} />
        <Tile
          label="Solved"
          value={counts.solved}
          sub={`problem${counts.solved === 1 ? '' : 's'}`}
        />
      </dl>

      <div className="topics-head">
        <h2>Topics</h2>
        <p className="topic-legend small muted" aria-hidden="true">
          <span>
            <i className="seg-unaided" /> Unaided
          </span>
          <span>
            <i className="seg-helped" /> With help
          </span>
          <span>
            <i className="seg-tried" /> Tried
          </span>
          <span>{COMFORTABLE_AFTER} unaided solves make a topic comfortable</span>
        </p>
      </div>
      <div className="topic-groups-grid">
        {groups.map((g) => (
          <section key={g} className="card topic-card">
            <h3 className="section-label">{GROUP_NAMES[g] ?? titleCase(g)}</h3>
            <ul className="topic-rows">
              {topics
                .filter((t) => t.group === g)
                .map((t) => (
                  <TopicRow key={t.id} t={t} />
                ))}
            </ul>
          </section>
        ))}
      </div>

      {status && status.active.length > 0 && (
        <section>
          <h2>Active problems</h2>
          <ul className="active-list">
            {status.active.map((a) => (
              <li key={a.slug}>
                <Link to={`/p/${a.slug}`}>{a.slug}</Link>
                {a.topic && <span className="muted"> · {topicName(a.topic)}</span>}
                {a.started_at && (
                  <span className="muted small"> · started {when(a.started_at)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Recent attempts</h2>
        {attempts && attempts.length === 0 && <p className="muted">No attempts yet.</p>}
        {attempts && attempts.length > 0 && (
          <table className="attempts-table">
            <thead>
              <tr>
                <th>Problem</th>
                <th>Topic</th>
                <th>Outcome</th>
                <th className="num">Tests</th>
                <th className="num">Hints</th>
                <th>Ended</th>
              </tr>
            </thead>
            <tbody>
              {attempts
                .slice()
                .reverse()
                .map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/p/${a.slug}`}>{a.slug}</Link>
                    </td>
                    <td className="muted">{a.topic ? topicName(a.topic) : ''}</td>
                    <td>
                      {a.outcome && (
                        <Badge tone={OUTCOME_TONE[a.outcome]}>
                          {OUTCOME_LABEL[a.outcome] ?? a.outcome}
                        </Badge>
                      )}
                    </td>
                    <td className="num">
                      {a.tests_total === null ? '—' : `${a.tests_passed ?? 0}/${a.tests_total}`}
                    </td>
                    <td className="num">{a.hints_used}</td>
                    <td className="small muted">{when(a.ended_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
