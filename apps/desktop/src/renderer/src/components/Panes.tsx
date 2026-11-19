/** Three resizable panes; stacked tabs under 900 px (ported from `dsa-tutor/web`). */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useMedia, useStored } from '../lib/hooks';

export interface Pane {
  id: string;
  title: string;
  content: ReactNode;
}

const MIN = 15; // percent

export function Panes({
  panes,
  tab,
  onTab,
}: {
  panes: [Pane, Pane, Pane];
  tab?: string;
  onTab?: (id: string) => void;
}) {
  const narrow = useMedia('(max-width: 899px)');
  const [sizes, setSizes] = useStored<[number, number, number]>('pane-sizes', [32, 40, 28]);
  const [localTab, setLocalTab] = useState(panes[1].id);
  const active = tab ?? localTab;
  const setTab = onTab ?? setLocalTab;
  const box = useRef<HTMLDivElement>(null);

  function drag(index: 0 | 1) {
    return (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = box.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const start = [...sizes] as [number, number, number];
      const x0 = e.clientX;
      const move = (ev: globalThis.PointerEvent) => {
        const delta = ((ev.clientX - x0) / rect.width) * 100;
        const next = [...start] as [number, number, number];
        const pair = start[index] + start[(index + 1) as 1 | 2];
        next[index] = Math.min(pair - MIN, Math.max(MIN, start[index] + delta));
        next[index + 1] = pair - next[index];
        setSizes(next);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing');
      };
      document.body.classList.add('resizing');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

  function key(index: 0 | 1) {
    return (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.key === 'ArrowLeft' ? -2 : e.key === 'ArrowRight' ? 2 : 0;
      if (!step) return;
      e.preventDefault();
      const next = [...sizes] as [number, number, number];
      const pair = next[index] + next[(index + 1) as 1 | 2];
      next[index] = Math.min(pair - MIN, Math.max(MIN, next[index] + step));
      next[index + 1] = pair - next[index];
      setSizes(next);
    };
  }

  if (narrow) {
    return (
      <div className="panes-narrow">
        <div className="tabs" role="tablist">
          {panes.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={active === p.id}
              className={active === p.id ? 'tab active' : 'tab'}
              onClick={() => setTab(p.id)}
            >
              {p.title}
            </button>
          ))}
        </div>
        {panes.map((p) => (
          <div
            key={p.id}
            role="tabpanel"
            className="pane"
            hidden={active !== p.id}
            aria-label={p.title}
          >
            {p.content}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="panes"
      ref={box}
      style={{ gridTemplateColumns: `${sizes[0]}fr 6px ${sizes[1]}fr 6px ${sizes[2]}fr` }}
    >
      <section className="pane" aria-label={panes[0].title}>
        {panes[0].content}
      </section>
      <div
        className="gutter"
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label="Resize"
        onPointerDown={drag(0)}
        onKeyDown={key(0)}
      />
      <section className="pane" aria-label={panes[1].title}>
        {panes[1].content}
      </section>
      <div
        className="gutter"
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label="Resize"
        onPointerDown={drag(1)}
        onKeyDown={key(1)}
      />
      <section className="pane" aria-label={panes[2].title}>
        {panes[2].content}
      </section>
    </div>
  );
}
