/**
 * The Library page (T22, SPEC §15.6): folder tree with filter and Refresh,
 * the reader with its margin chats, and the chat pane (T24), in the practice
 * view's resizable panes. While the page is open, main rescans on file
 * changes (`library:watch`) and sends the tree after each scan.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AnchorView } from '../../../shared/article-chat';
import type { ArticleView, TreeView } from '../../../shared/library';
import { Link } from '../components/Link';
import { Panes } from '../components/Panes';
import { invoke, stream } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { LibraryTree } from '../library/LibraryTree';
import { WriteArticle } from '../library/WriteArticle';
import { ArticleChatPane } from '../library/chat/ArticleChatPane';
import { PassageLayer } from '../library/chat/PassageLayer';
import { useArticleChats } from '../library/chat/useArticleChats';
import { Reader } from '../library/Reader';

export function LibraryPage({ article }: { article: string | null }) {
  const app = useApp();
  const [tree, setTree] = useState<TreeView | null>(null);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(article ? 'reader' : 'articles');
  const chats = useArticleChats(article);
  const [missing, setMissing] = useState(false);
  const onArticle = useCallback((a: ArticleView | null) => setMissing(!!a?.missing), []);
  const { ask } = chats;
  const onAsk = useCallback(
    (anchor: AnchorView) => {
      ask(anchor);
      setTab('chats');
    },
    [ask],
  );

  useEffect(() => {
    let live = true;
    void invoke('library:tree').then(
      (t) => live && setTree((cur) => cur ?? t),
      () => undefined,
    );
    const s = stream('library:watch', undefined, (t) => {
      if (!live) return;
      setTree(t);
      // A rescan may have changed the open article: the reader reloads it.
      setVersion((v) => v + 1);
    });
    s.result.catch(() => undefined);
    return () => {
      live = false;
      s.cancel();
    };
  }, []);

  // Opening an article (narrow window: tabs) shows the reader.
  const [shown, setShown] = useState(article);
  if (shown !== article) {
    setShown(article);
    if (article) setTab('reader');
  }

  async function refresh(): Promise<void> {
    setBusy(true);
    try {
      setTree(await invoke('library:refresh'));
      setVersion((v) => v + 1);
    } catch (e) {
      app.notify(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const empty = tree !== null && tree.folders.length === 0;

  const left = (
    <div className="lib-left">
      <div className="lib-tools">
        <input
          type="search"
          placeholder="Filter by title or tag"
          aria-label="Filter articles"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <WriteArticle
        onWritten={() => {
          void invoke('library:tree').then(setTree, () => undefined);
        }}
      />
      {tree === null ? (
        <p className="muted small">Loading…</p>
      ) : empty ? (
        <p className="muted small" data-testid="library-page-empty">
          No folders yet. Add one in <Link to="/settings">Settings → Library</Link>.
        </p>
      ) : (
        <LibraryTree tree={tree} filter={filter} selected={article} />
      )}
    </div>
  );

  const leftActions = (
    <>
      <span className="spacer" />
      <button
        type="button"
        className="small-button"
        onClick={() => void refresh()}
        disabled={busy || empty}
      >
        {busy ? 'Refreshing…' : 'Refresh'}
      </button>
    </>
  );

  const middle = article ? (
    <Reader
      id={article}
      version={version}
      onArticle={onArticle}
      layer={(body, html) => <PassageLayer body={body} html={html} chats={chats} onAsk={onAsk} />}
    />
  ) : (
    <p className="muted reader-pad">Choose an article to read.</p>
  );

  const right = article ? (
    <ArticleChatPane chats={chats} missing={missing} />
  ) : (
    <p className="muted reader-pad">Open an article to see its chats.</p>
  );

  return (
    <main className="practice library-page">
      <Panes
        tab={tab}
        onTab={setTab}
        storageKey="library-pane-sizes"
        initialSizes={[24, 52, 24]}
        panes={[
          { id: 'articles', title: 'Articles', content: left, actions: leftActions },
          { id: 'reader', title: 'Reader', content: middle },
          {
            id: 'chats',
            title: 'Chats',
            content: right,
            // The chats pane draws its own header once an article is open.
            header: !article,
          },
        ]}
      />
    </main>
  );
}
