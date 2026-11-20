/**
 * Home (T31, docs/design.md → Home): a dashboard with the problem in progress
 * ("Continue"), the next-problem pick and its reason ("Recommended next"), a
 * compact progress summary, and the general tutor chat in a card.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, CircleCheck, Compass, Play, Sparkles } from 'lucide-react';
import type { NextResponse, ProblemListItem, StatusResponse } from '../../../shared/practice';
import { ChatPane } from '../chat/ChatPane';
import { Link } from '../components/Link';
import { Button, buttonClass } from '../components/ui';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { when } from '../lib/format';
import { ago, levelCounts, reasonText } from './dashboard';
import { DifficultyDot } from './problem-bits';
import './home.css';

type Active = StatusResponse['active'][number];

export function HomePage({ onNext, nextBusy }: { onNext: () => void; nextBusy: boolean }) {
  const { version, topics, topicName } = useApp();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [titles, setTitles] = useState<Map<string, ProblemListItem>>(new Map());
  const [next, setNext] = useState<NextResponse | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke('status:get').then(
      (s) => {
        if (cancelled) return;
        setStatus(s);
        if (s.active.length === 0) return;
        invoke('problems:list', { status: 'active' }).then(
          (r) => !cancelled && setTitles(new Map(r.problems.map((p) => [p.slug, p]))),
          () => undefined,
        );
      },
      (e: unknown) => !cancelled && setError(errorText(e)),
    );
    invoke('problems:next', { preview: true }).then(
      (r) => !cancelled && setNext(r),
      () => !cancelled && setNext(null),
    );
    return () => {
      cancelled = true;
    };
  }, [version]);

  const active = (status?.active ?? [])
    .slice()
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const [current, ...others] = active;
  const counts = levelCounts(topics);

  return (
    <main className="page home">
      <div className="home-inner">
        <header className="home-head">
          <h1>Practice</h1>
          <p className="muted">Pick up where you left off, or start the next problem.</p>
        </header>
        {error && <p className="error-text">{error}</p>}

        <div className="home-grid">
          <section className="card home-card" aria-labelledby="home-continue">
            <h2 className="section-label" id="home-continue">
              Continue
            </h2>
            {!status ? (
              <p className="muted">Loading…</p>
            ) : current ? (
              <ContinueCard
                current={current}
                others={others}
                titles={titles}
                topicName={topicName}
              />
            ) : (
              <div className="home-empty">
                <CircleCheck size={20} aria-hidden="true" />
                <p>
                  Nothing in progress. Start the recommended problem or{' '}
                  <Link to="/problems">browse all problems</Link>.
                </p>
              </div>
            )}
          </section>

          <section className="card home-card" aria-labelledby="home-next">
            <h2 className="section-label" id="home-next">
              Recommended next
            </h2>
            <Recommended next={next} />
            <div className="home-card-actions">
              <Button
                variant={current ? 'secondary' : 'primary'}
                icon={<Sparkles aria-hidden="true" />}
                onClick={onNext}
                disabled={nextBusy}
              >
                {nextBusy ? 'Picking…' : next?.action === 'generate' ? 'Create it' : 'Start'}
              </Button>
              <Link to="/problems" className={buttonClass('ghost')}>
                Browse problems
              </Link>
            </div>
          </section>
        </div>

        <section className="card home-summary" aria-labelledby="home-progress">
          <h2 className="section-label" id="home-progress">
            Progress
          </h2>
          <dl className="home-stats">
            <Stat label="Comfortable" value={counts.comfortable} tone="pass" />
            <Stat label="Learning" value={counts.learning} tone="warn" />
            <Stat label="Not started" value={counts.new} />
            <Stat label="Problems solved" value={counts.solved} />
          </dl>
          <Link to="/progress" className="home-summary-link">
            All topics <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </section>

        <section className="home-chat card" aria-label="Tutor chat">
          <ChatPane slug={null} />
        </section>
      </div>
    </main>
  );
}

function ContinueCard({
  current,
  others,
  titles,
  topicName,
}: {
  current: Active;
  others: Active[];
  titles: Map<string, ProblemListItem>;
  topicName: (id: string) => string;
}) {
  const item = titles.get(current.slug);
  const title = item?.title ?? current.slug;
  return (
    <>
      <div className="home-problem">
        <Link to={`/p/${current.slug}`} className="home-problem-title">
          {title}
        </Link>
        <p className="home-meta">
          {current.topic && <span>{topicName(current.topic)}</span>}
          {item && <DifficultyDot difficulty={item.difficulty} />}
          <span title={when(current.started_at)}>Started {ago(current.started_at)}</span>
          {current.hints_used > 0 && (
            <span>
              {current.hints_used} hint{current.hints_used === 1 ? '' : 's'}
            </span>
          )}
        </p>
      </div>
      <div className="home-card-actions">
        <Link to={`/p/${current.slug}`} className={buttonClass('primary')}>
          <Play aria-hidden="true" />
          Resume
        </Link>
      </div>
      {others.length > 0 && (
        <p className="home-others small">
          <span className="muted">Also in progress: </span>
          {others.map((a, i) => (
            <span key={a.slug}>
              {i > 0 && ', '}
              <Link to={`/p/${a.slug}`}>{titles.get(a.slug)?.title ?? a.slug}</Link>
            </span>
          ))}
        </p>
      )}
    </>
  );
}

function Recommended({ next }: { next: NextResponse | null | undefined }) {
  if (next === undefined) return <p className="muted">Loading…</p>;
  if (next === null)
    return (
      <div className="home-empty">
        <Compass size={20} aria-hidden="true" />
        <p>No pick right now. Next problem in the title bar asks again.</p>
      </div>
    );
  return (
    <div className="home-problem">
      <p className="home-problem-title">
        {next.action === 'solve' ? next.title : `A new ${next.topic_name} problem`}
      </p>
      <p className="home-meta">
        <span>{next.topic_name}</span>
        <DifficultyDot difficulty={next.difficulty} />
        {next.action === 'generate' && <span>The tutor writes it</span>}
      </p>
      <p className="home-reason" data-testid="home-reason">
        {reasonText(next)}
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'pass' | 'warn' }) {
  return (
    <div className={tone ? `home-stat home-stat-${tone}` : 'home-stat'}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
