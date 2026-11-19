import { useEffect, useState } from 'react';
/** Progress (ported from `dsa-tutor/web`): level per topic, active problems, recent attempts. */
import type { AttemptView, StatusResponse } from '../../../shared/practice';
import { Link } from '../components/Link';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { OUTCOME_LABEL, titleCase, when } from '../lib/format';

const COMFORTABLE_AFTER = 3;
/** Group names as `dsa-tutor`'s profile form showed them (T09 moves them next to the questions). */
const GROUP_NAMES: Record<string, string> = {
  basics: 'Basics',
  linear: 'Linear',
  'search-sort': 'Search & sort',
  'trees-graphs': 'Trees & graphs',
  'recursion-dp': 'Recursion & DP',
};

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

  return (
    <main className="page">
      <h1>Progress</h1>
      {error && <p className="error-text">{error}</p>}
      {status && (
        <p className="muted">
          {topics.filter((t) => t.level === 'comfortable').length} of {topics.length} topics
          comfortable · {status.untouched_topics} not started
        </p>
      )}
      <div className="topic-groups">
        {groups.map((g) => (
          <section key={g} className="card">
            <h2>{GROUP_NAMES[g] ?? titleCase(g)}</h2>
            <ul className="topic-list">
              {topics
                .filter((t) => t.group === g)
                .map((t) => (
                  <li key={t.id} data-testid={`topic-${t.id}`}>
                    <span className="topic-name">{t.name}</span>
                    <span className={`pill level-${t.level}`}>{titleCase(t.level)}</span>
                    <meter
                      min={0}
                      max={COMFORTABLE_AFTER}
                      value={Math.min(t.solved_unaided, COMFORTABLE_AFTER)}
                      aria-label={`${t.name}: ${t.solved_unaided} of ${COMFORTABLE_AFTER} unaided solves`}
                    />
                    <span className="small muted">
                      {t.solved_unaided}/{COMFORTABLE_AFTER} unaided · {t.solved} solved ·{' '}
                      {t.attempted} tried
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>

      {status && status.active.length > 0 && (
        <section>
          <h2>Active problems</h2>
          <ul className="list">
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
          <table className="problem-table">
            <thead>
              <tr>
                <th>Problem</th>
                <th>Topic</th>
                <th>Outcome</th>
                <th>Tests</th>
                <th>Hints</th>
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
                    <td>{a.topic ? topicName(a.topic) : ''}</td>
                    <td>
                      <span className={`pill outcome-${a.outcome ?? ''}`}>
                        {a.outcome ? (OUTCOME_LABEL[a.outcome] ?? a.outcome) : ''}
                      </span>
                    </td>
                    <td>
                      {a.tests_passed}/{a.tests_total}
                    </td>
                    <td>{a.hints_used}</td>
                    <td className="small">{when(a.ended_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
