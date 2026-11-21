/**
 * Listens for the leader key (T36, D-57; see `leader.ts`). The leader is
 * caught before anything else on the page (the code editor included), so it
 * works wherever focus is; the next key is caught the same way and runs the
 * action bound to it. Escape, the leader again, a key with no action, or the
 * window losing focus stop waiting. While a dialog is open the leader is left
 * alone. `?` lists the actions.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../lib/app-context';
import { Dialog } from './Dialog';
import {
  isLeader,
  LeaderContext,
  leaderLabel,
  MODIFIER_KEYS,
  type LeaderApi,
  type LeaderBinding,
  type LeaderSetting,
} from './leader';

/** How a binding's keys read in the help list. */
const KEY_NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

function KeyList({ keys }: { keys: string[] }) {
  return (
    <>
      {keys.map((k, i) => (
        <span key={k}>
          {i > 0 && <span className="faint"> or </span>}
          <kbd>{KEY_NAMES[k] ?? k}</kbd>
        </span>
      ))}
    </>
  );
}

/** The leader from Settings (`ui.leader`). */
export function LeaderProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  return <LeaderKeys setting={app.settings?.settings.ui.leader ?? 'ctrl+b'}>{children}</LeaderKeys>;
}

/** The leader given directly (tests). */
export function LeaderKeys({ setting, children }: { setting: LeaderSetting; children: ReactNode }) {
  const label = leaderLabel(setting);
  const sources = useRef<(() => LeaderBinding[])[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [help, setHelp] = useState<LeaderBinding[] | null>(null);
  const waitingRef = useRef(false);

  const api = useMemo<LeaderApi>(
    () => ({
      register(get) {
        sources.current = [...sources.current, get];
        return () => {
          sources.current = sources.current.filter((s) => s !== get);
        };
      },
      label,
    }),
    [label],
  );

  /** Every binding in the order registered; a later one wins a shared key. */
  const all = (): LeaderBinding[] => {
    const own: LeaderBinding = {
      keys: ['?'],
      label: 'Show these actions',
      group: 'General',
      run: () => setHelp(all()),
    };
    return [...sources.current.flatMap((get) => get()), own];
  };
  const allRef = useRef(all);
  useEffect(() => {
    allRef.current = all;
  });

  useEffect(() => {
    const stop = (): void => {
      waitingRef.current = false;
      setWaiting(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (waitingRef.current) {
        if (MODIFIER_KEYS.has(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        stop();
        if (e.key === 'Escape' || isLeader(e, setting)) return;
        allRef
          .current()
          .find((b) => b.keys.includes(e.key))
          ?.run();
        return;
      }
      if (!isLeader(e, setting)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      waitingRef.current = true;
      setWaiting(true);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', stop);
      stop();
    };
  }, [setting]);

  const groups = help
    ? [...new Set(help.map((b) => b.group))].map((g) => ({
        group: g,
        // A binding whose key a later one took is not listed.
        items: help.filter(
          (b, i) =>
            b.group === g && !help.slice(i + 1).some((o) => o.keys.some((k) => b.keys.includes(k))),
        ),
      }))
    : [];

  return (
    <LeaderContext.Provider value={api}>
      {children}
      {waiting && label && (
        <div className="leader-waiting" role="status" data-testid="leader-waiting">
          <kbd>{label}</kbd> <span className="muted">then a key · ? for the list · Esc</span>
        </div>
      )}
      {help && (
        <Dialog
          titleId="leader-help-title"
          title="Leader key actions"
          className="leader-help-dialog"
          onClose={() => setHelp(null)}
        >
          <p className="muted small">
            Press <kbd>{label}</kbd>, let go, then one of these keys. The leader can be changed in
            Settings → Appearance and editor.
          </p>
          {groups.map(({ group, items }) => (
            <section key={group} className="leader-help-group">
              <h3 className="section-label">{group}</h3>
              <dl className="leader-help">
                {items.map((b) => (
                  <div key={b.label}>
                    <dt>
                      <KeyList keys={b.keys} />
                    </dt>
                    <dd>{b.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </Dialog>
      )}
    </LeaderContext.Provider>
  );
}
