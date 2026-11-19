/**
 * A problem's kept explanations, reloaded when the tutor renders a new one
 * (the chat's `open_explanation` event for that problem).
 */
import { useCallback, useEffect, useState } from 'react';
import type { ExplanationVersionView } from '../../../shared/tutor';
import { useChatStore } from '../chat/store';
import { invoke } from '../ipc';

export function useVersions(slug: string) {
  const chat = useChatStore();
  const [versions, setVersions] = useState<ExplanationVersionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    invoke('explanations:list', { slug }).then(
      (r) => {
        if (!live) return;
        setVersions(r.versions);
        setError(null);
      },
      (e: Error) => {
        if (live) setError(e.message);
      },
    );
    return () => {
      live = false;
    };
  }, [slug, tick]);

  useEffect(
    () =>
      chat.onUi((ev) => {
        if (ev.action === 'open_explanation' && ev.slug === slug) reload();
      }),
    [chat, slug, reload],
  );

  return { versions, error, reload };
}
