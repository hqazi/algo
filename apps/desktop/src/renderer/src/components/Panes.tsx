/**
 * Three resizable panes; stacked tabs under 900 px (ported from
 * `dsa-tutor/web`). Edge to edge (T29): the panes meet at 1px dividers that
 * are the resize handles (drag, or focus and press the arrow keys). Each pane
 * gets a `PaneHeader` with its title and `actions`, unless its content draws
 * its own (`header: false`).
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useMedia, useStored } from '../lib/hooks';
import { PaneHeader } from './PaneHeader';

export interface Pane {
  id: string;
  title: string;
  content: ReactNode;
  /** Shown in the pane's header after the title. */
  actions?: ReactNode;
  /** False when the content has its own `PaneHeader` (default true). */
  header?: boolean;
}

function PaneBody({ pane }: { pane: Pane }) {
  if (pane.header === false) return <>{pane.content}</>;
  return (
    <>
      <PaneHeader title={pane.title}>{pane.actions}</PaneHeader>
      <div className="pane-body">{pane.content}</div>
    </>
  );
}

const MIN = 15; // percent

export function Panes({
  panes,
  tab,
  onTab,
  storageKey = 'pane-sizes',
  initialSizes = [32, 40, 28],
}: {
  panes: [Pane, Pane, Pane];
  tab?: string;
  onTab?: (id: string) => void;
  /** Where the sizes are remembered (each page its own). */
  storageKey?: string;
  initialSizes?: [number, number, number];
}) {
  const narrow = useMedia('(max-width: 899px)');
  const [sizes, setSizes] = useStored<[number, number, number]>(storageKey, initialSizes);
  const [localTab, setLocalTab] = useState(panes[1].id);
  const active = tab ?? localTab;
  const setTab = onTab ?? setLocalTab;
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<0 | 1 | null>(null);

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
        setDragging(null);
      };
      document.body.classList.add('resizing');
      setDragging(index);
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

  const gutter = (index: 0 | 1) => (
    <div
      className={dragging === index ? 'gutter dragging' : 'gutter'}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(sizes[index])}
      aria-valuemin={MIN}
      aria-valuemax={100 - MIN}
      tabIndex={0}
      aria-label="Resize"
      onPointerDown={drag(index)}
      onKeyDown={key(index)}
    />
  );

  // One tree for both layouts, so crossing 900px keeps each pane's state
  // (editor, drafts, open chats): only the tabs and gutters come and go.
  const section = (index: 0 | 1 | 2) => {
    const p = panes[index];
    return (
      <section
        key={p.id}
        className="pane"
        aria-label={p.title}
        {...(narrow ? { role: 'tabpanel', hidden: active !== p.id } : {})}
      >
        <PaneBody pane={p} />
      </section>
    );
  };

  return (
    <div
      className={narrow ? 'panes-narrow' : 'panes'}
      ref={box}
      style={
        narrow
          ? undefined
          : { gridTemplateColumns: `${sizes[0]}fr 1px ${sizes[1]}fr 1px ${sizes[2]}fr` }
      }
    >
      {narrow ? (
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
      ) : null}
      {section(0)}
      {narrow ? null : gutter(0)}
      {section(1)}
      {narrow ? null : gutter(1)}
      {section(2)}
    </div>
  );
}
