/** Home (ported from `dsa-tutor/web`): next problem, the general chat, unfinished and recent attempts. */
import { useEffect, useState } from 'react';
import type { StatusResponse } from '../../../shared/practice';
import { Link } from '../components/Link';
import { ChatPane } from '../chat/ChatPane';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { OUTCOME_LABEL } from '../lib/format';

export function HomePage({ onNext, nextBusy }: { onNext: () => void; nextBusy: boolean }) {
  const { version, topicName } = useApp();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke('status:get').then(setStatus, (e: unknown) => setError(errorText(e)));
  }, [version]);

  return (
    <main className="page narrow-page">
      <h1>Practice</h1>
      {error && <p className="error-text">{error}</p>}
      <p>
        <button type="button" className="primary big" onClick={onNext} disabled={nextBusy}>
          {nextBusy ? 'Picking…' : 'Next problem'}
        </button>
        <span className="muted">
          {' '}
          or <Link to="/problems">browse all problems</Link>.
        </span>
      </p>
      <section className="home-chat card">
        <ChatPane slug={null} />
      </section>
      {status && status.active.length > 0 && (
        <section>
          <h2>Unfinished</h2>
          <ul className="list">
            {status.active.map((a) => (
              <li key={a.slug}>
                <Link to={`/p/${a.slug}`}>{a.slug}</Link>
                {a.topic && <span className="muted"> · {topicName(a.topic)}</span>}
                {!!a.hints_used && (
                  <span className="muted">
                    {' '}
                    · {a.hints_used} hint{a.hints_used === 1 ? '' : 's'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {status && status.recent.length > 0 && (
        <section>
          <h2>Recent</h2>
          <ul className="list">
            {status.recent
              .slice()
              .reverse()
              .map((a) => (
                <li key={`${a.slug}${a.ended_at ?? ''}`}>
                  <Link to={`/p/${a.slug}`}>{a.slug}</Link>
                  <span className="muted">
                    {' '}
                    · {a.outcome ? (OUTCOME_LABEL[a.outcome] ?? a.outcome) : ''}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </main>
  );
}
