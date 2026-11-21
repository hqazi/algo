/**
 * Three resizable panes; stacked tabs under 900 px (ported from
 * `dsa-tutor/web`). Edge to edge (T29): the panes meet at 1px dividers that
 * are the resize handles (drag, or focus and press the arrow keys). Each pane
 * gets a `PaneHeader` with its title and `actions`, unless its content draws
 * its own (`header: false`).
 *
 * The side panes collapse to a thin rail (T35): the button at the end of their
 * header, or the leader key (T36) then `[` (left) or `]` (right); leader `z`
 * hides both and brings them back. Leader `h`/`l` (or arrows), `o` and `1`–`3`
 * move between panes, as do Ctrl/Cmd+1, 2 and 3 and F6/Shift+F6. Going to a
 * collapsed pane opens it. A collapsed pane stays mounted, so its state (a
 * chat draft) survives.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { useMedia, useStored } from '../lib/hooks';
import { PaneHeader } from './PaneHeader';
import { leaderKeys, useLeader, useLeaderBindings } from './leader';
import { isMod, PaneControlContext, type PaneControl } from './pane-control';

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
      <div className="pane-body" tabIndex={-1}>
        {pane.content}
      </div>
    </>
  );
}

const MIN = 15; // percent

/** Where focus goes in a pane: its text box or editor, else the scrolling body. */
function focusInto(section: HTMLElement): void {
  const target =
    section.querySelector<HTMLElement>('.cm-content, textarea:not(:disabled)') ??
    section.querySelector<HTMLElement>('.pane-body') ??
    section;
  target.focus();
}

type Collapsed = [left: boolean, right: boolean];

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
  /** Where the sizes are remembered (each page its own); collapsed panes under `<key>-collapsed`. */
  storageKey?: string;
  initialSizes?: [number, number, number];
}) {
  const narrow = useMedia('(max-width: 899px)');
  const [sizes, setSizes] = useStored<[number, number, number]>(storageKey, initialSizes);
  const [stored, setCollapsed] = useStored<Collapsed>(`${storageKey}-collapsed`, [false, false]);
  // Stacked tabs show one pane at a time: nothing is collapsed there.
  const collapsed: Collapsed = narrow ? [false, false] : stored;
  const [localTab, setLocalTab] = useState(panes[1].id);
  const active = tab ?? localTab;
  const setTab = onTab ?? setLocalTab;
  const box = useRef<HTMLDivElement>(null);
  const sections = useRef<(HTMLElement | null)[]>([null, null, null]);
  const [dragging, setDragging] = useState<0 | 1 | null>(null);
  // Focus waits for the pane to open (and the tab to switch) before moving in.
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);

  const isCollapsed = (index: number): boolean =>
    index === 0 ? collapsed[0] : index === 2 ? collapsed[1] : false;

  function setSide(side: 0 | 1, value: boolean): void {
    const next: Collapsed = [...stored];
    next[side] = value;
    setCollapsed(next);
  }

  function collapse(index: 0 | 2): void {
    const section = sections.current[index];
    // Focus would be lost to the page: move it to the middle pane.
    if (section?.contains(document.activeElement)) setPendingFocus(1);
    setSide(index === 0 ? 0 : 1, true);
  }

  function goTo(index: number): void {
    if (narrow) setTab(panes[index]!.id);
    else if (index !== 1 && isCollapsed(index)) setSide(index === 0 ? 0 : 1, false);
    setPendingFocus(index);
  }

  useEffect(() => {
    if (pendingFocus === null) return;
    const section = sections.current[pendingFocus];
    if (section) focusInto(section);
    setPendingFocus(null);
  }, [pendingFocus, stored, narrow, active]);

  /** The pane with focus (the middle one when none has it). */
  const here = (): number => {
    const i = sections.current.findIndex((s) => s?.contains(document.activeElement));
    return i < 0 ? 1 : i;
  };
  const toggle = (index: 0 | 2): void => (isCollapsed(index) ? goTo(index) : collapse(index));

  // Leader `z`: hide both side panes, then put back what was open.
  const unzoom = useRef<Collapsed | null>(null);
  function zoom(): void {
    if (narrow) return;
    if (!stored[0] || !stored[1]) {
      unzoom.current = stored;
      if (here() !== 1) setPendingFocus(1);
      setCollapsed([true, true]);
    } else {
      setCollapsed(unzoom.current ?? [false, false]);
      unzoom.current = null;
    }
  }

  useLeaderBindings([
    {
      keys: ['h', 'ArrowLeft'],
      label: 'Go to the pane on the left',
      group: 'Panes',
      run: () => goTo(Math.max(0, here() - 1)),
    },
    {
      keys: ['l', 'ArrowRight'],
      label: 'Go to the pane on the right',
      group: 'Panes',
      run: () => goTo(Math.min(2, here() + 1)),
    },
    {
      keys: ['o'],
      label: 'Go to the next pane',
      group: 'Panes',
      run: () => goTo((here() + 1) % 3),
    },
    ...([0, 1, 2] as const).map((i) => ({
      keys: [String(i + 1)],
      label: `Go to ${panes[i].title}`,
      group: 'Panes',
      run: () => goTo(i),
    })),
    ...(narrow
      ? []
      : [
          {
            keys: ['['],
            label: `Hide or show ${panes[0].title}`,
            group: 'Panes',
            run: () => toggle(0),
          },
          {
            keys: [']'],
            label: `Hide or show ${panes[2].title}`,
            group: 'Panes',
            run: () => toggle(2),
          },
          {
            keys: ['z'],
            label: `Hide both side panes, or bring them back`,
            group: 'Panes',
            run: zoom,
          },
        ]),
  ]);

  // Direct keys (not behind the leader): Ctrl/Cmd+1-3 and F6.
  const keys = useRef({ goTo });
  keys.current = { goTo };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const k = keys.current;
      const digit = /^Digit([1-3])$/.exec(e.code);
      if (digit && isMod(e)) {
        e.preventDefault();
        k.goTo(Number(digit[1]) - 1);
        return;
      }
      if (e.key === 'F6' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const here = sections.current.findIndex((s) => s?.contains(document.activeElement));
        const from = here < 0 ? (e.shiftKey ? 0 : 2) : here;
        k.goTo((from + (e.shiftKey ? 2 : 1)) % 3);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Fractions of the space the open panes share (100 when none is collapsed).
  const openTotal = sizes.reduce((sum, s, i) => (isCollapsed(i) ? sum : sum + s), 0);

  function drag(index: 0 | 1) {
    return (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = box.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const start = [...sizes] as [number, number, number];
      const x0 = e.clientX;
      const move = (ev: globalThis.PointerEvent) => {
        const delta = ((ev.clientX - x0) / rect.width) * openTotal;
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

  const gutter = (index: 0 | 1) =>
    // Beside a collapsed pane the divider is a plain line: there is nothing to resize.
    isCollapsed(index === 0 ? 0 : 2) ? (
      <div className="divider-line" aria-hidden="true" />
    ) : (
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

  const leader = useLeader()?.label ?? null;
  const shortcuts = { left: leaderKeys(leader, '['), right: leaderKeys(leader, ']') };

  // One tree for both layouts, so crossing 900px keeps each pane's state
  // (editor, drafts, open chats): only the tabs, gutters and rails come and go.
  const section = (index: 0 | 1 | 2) => {
    const p = panes[index];
    const side = index === 0 ? 'left' : index === 2 ? 'right' : null;
    const shut = isCollapsed(index);
    const control: PaneControl | null =
      side && !narrow
        ? {
            side,
            title: p.title,
            shortcut: shortcuts[side],
            collapse: () => collapse(index as 0 | 2),
          }
        : null;
    const Open = side === 'right' ? PanelRightOpen : PanelLeftOpen;
    return (
      <section
        key={p.id}
        ref={(el) => {
          sections.current[index] = el;
        }}
        className={shut ? 'pane collapsed' : 'pane'}
        aria-label={p.title}
        tabIndex={-1}
        {...(narrow ? { role: 'tabpanel', hidden: active !== p.id } : {})}
      >
        {shut && side && (
          <button
            type="button"
            className="pane-rail"
            aria-label={`Show ${p.title}`}
            aria-expanded={false}
            title={shortcuts[side] ? `Show ${p.title} (${shortcuts[side]})` : `Show ${p.title}`}
            onClick={() => goTo(index)}
          >
            <Open size={16} aria-hidden="true" />
            <span className="pane-rail-title">{p.title}</span>
          </button>
        )}
        <div className="pane-inner" hidden={shut}>
          <PaneControlContext.Provider value={control}>
            <PaneBody pane={p} />
          </PaneControlContext.Provider>
        </div>
      </section>
    );
  };

  const column = (index: 0 | 1 | 2) =>
    isCollapsed(index) ? 'var(--pane-rail-w)' : `${sizes[index]}fr`;

  return (
    <div
      className={narrow ? 'panes-narrow' : 'panes'}
      ref={box}
      style={
        narrow
          ? undefined
          : { gridTemplateColumns: `${column(0)} 1px ${column(1)} 1px ${column(2)}` }
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
