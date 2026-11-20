/**
 * App-wide handling of the chat's UI events (SPEC §7.3). Mounted once in the
 * shell; works whichever page is showing, since replies outlive the pane.
 *   open_problem      go to the problem (the pane there keeps the thread)
 *   open_explanation  show the explanation panel
 *   refresh_state     reload profile, progress and the tutor status
 *   show_results      handled by the practice page for its own problem
 * Ported from `dsa-tutor/web/src/chat/ChatEffects.tsx`.
 */
import { useEffect, useState } from 'react';
import { ExplanationViewer } from '../explanation/ExplanationViewer';
import { navigate } from '../lib/router';
import { useChatStore } from './store';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function ChatEffects({ onRefresh }: { onRefresh: () => void | Promise<void> }) {
  const store = useChatStore();
  const [explanation, setExplanation] = useState<string | null>(null);

  useEffect(
    () =>
      store.onUi((ev, thread) => {
        switch (ev.action) {
          case 'open_problem':
            // T25: a problem made from a passage is offered in the article's pane, not opened.
            if (!SLUG_RE.test(ev.slug) || thread.startsWith('article:')) return;
            store.follow = thread === ev.slug ? null : { from: thread, to: ev.slug };
            navigate(`/p/${ev.slug}`);
            break;
          case 'open_explanation':
            if (SLUG_RE.test(ev.slug)) setExplanation(ev.slug);
            break;
          case 'refresh_state':
            void onRefresh();
            break;
          default:
            break;
        }
      }),
    [store, onRefresh],
  );

  return explanation ? (
    <ExplanationViewer key={explanation} slug={explanation} onClose={() => setExplanation(null)} />
  ) : null;
}
