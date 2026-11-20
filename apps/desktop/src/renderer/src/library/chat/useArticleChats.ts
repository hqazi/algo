/**
 * The chats of the open article (T24, SPEC §15.5): its threads, the one that
 * is open, a passage waiting for its first question (a thread is created
 * only when that question is sent), where each thread's passage is in the
 * reader now, and the one-time provider notice.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AnchorState } from '@algo/core';
import type { AnchorView, ArticleThreadView } from '../../../../shared/article-chat';
import { invoke } from '../../ipc';

export interface ArticleChats {
  article: string | null;
  threads: ArticleThreadView[];
  loaded: boolean;
  /** The open thread, if any. */
  open: string | null;
  /** A passage chosen with **Ask about this** (or a heading's button), not yet asked about. */
  draft: AnchorView | null;
  /** Where each thread's passage is in the reader now (set by the passage layer). */
  states: Record<string, AnchorState>;
  setStates: (s: Record<string, AnchorState>) => void;
  ask: (anchor: AnchorView) => void;
  openThread: (id: string | null) => void;
  /** Creates the thread for the draft passage; returns its id. */
  createFromDraft: () => Promise<string>;
  rename: (id: string, title: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useArticleChats(article: string | null): ArticleChats {
  const [threads, setThreads] = useState<ArticleThreadView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnchorView | null>(null);
  const [states, setStates] = useState<Record<string, AnchorState>>({});

  const reload = useCallback(async () => {
    if (!article) return;
    const r = await invoke('library:threads', { article });
    if (r.article === article) {
      setThreads(r.threads);
      setLoaded(true);
    }
  }, [article]);

  // Another article: start from nothing (during render, not in an effect).
  const [shown, setShown] = useState(article);
  if (shown !== article) {
    setShown(article);
    setThreads([]);
    setLoaded(false);
    setOpen(null);
    setDraft(null);
    setStates({});
  }

  useEffect(() => {
    if (!article) return;
    let live = true;
    invoke('library:threads', { article }).then(
      (r) => {
        if (!live) return;
        setThreads(r.threads);
        setLoaded(true);
      },
      () => live && setLoaded(true),
    );
    return () => {
      live = false;
    };
  }, [article]);

  const ask = useCallback((anchor: AnchorView) => {
    setDraft(anchor);
    setOpen(null);
  }, []);

  const openThread = useCallback((id: string | null) => {
    setOpen(id);
    setDraft(null);
  }, []);

  const createFromDraft = useCallback(async () => {
    if (!article || !draft) throw new Error('no passage chosen');
    const { thread } = await invoke('library:thread-create', { article, anchor: draft });
    setDraft(null);
    setOpen(thread);
    await reload().catch(() => undefined);
    return thread;
  }, [article, draft, reload]);

  const rename = useCallback(
    async (id: string, title: string) => {
      await invoke('library:thread-rename', { thread: id, title });
      await reload();
    },
    [reload],
  );

  return {
    article,
    threads,
    loaded,
    open,
    draft,
    states,
    setStates,
    ask,
    openThread,
    createFromDraft,
    rename,
    reload,
  };
}

/** A short line for a passage: its quote, or the heading it is about. */
export function snippet(anchor: AnchorView | null, max = 90): string {
  if (!anchor) return 'Passage unknown';
  const text =
    anchor.quote ||
    (anchor.heading.length ? anchor.heading[anchor.heading.length - 1]! : 'The opening');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
