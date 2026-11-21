/**
 * The Library page (T22, SPEC §15.6): folder tree with filter and Refresh,
 * the reader with its margin chats, and the chat pane (T24), in the practice
 * view's resizable panes. While the page is open, main rescans on file
 * changes (`library:watch`) and sends the tree after each scan. Restyled in
 * T32 (docs/design.md → Library; the look is in `library.css`).
 */
import { useCallback, useEffect, useState } from 'react';
import { PenLine, RefreshCw, Search } from 'lucide-react';
import type { AnchorView } from '../../../shared/article-chat';
import type { ArticleView, FolderPlace, TreeView } from '../../../shared/library';
import { Link } from '../components/Link';
import { useLeaderBindings } from '../components/leader';
import { Panes } from '../components/Panes';
import { IconButton } from '../components/ui';
import { invoke, stream } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { LibraryTree } from '../library/LibraryTree';
import { WriteArticle } from '../library/WriteArticle';
import { ArticleChatPane } from '../library/chat/ArticleChatPane';
import { PassageLayer } from '../library/chat/PassageLayer';
import { useArticleChats } from '../library/chat/useArticleChats';
import { ReadAloudBar, ReadAloudButton, ReadAloudOffer } from '../library/ReadAloudBar';
import { Reader } from '../library/Reader';
import { useReadAloud } from '../library/useReadAloud';
import './library.css';

export function LibraryPage({ article }: { article: string | null }) {
  const app = useApp();
  const [tree, setTree] = useState<TreeView | null>(null);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  /** The Write dialog: `undefined` closed, else the folder to save in (`null`: the tutor's). */
  const [writing, setWriting] = useState<FolderPlace | null | undefined>(undefined);
  const [tab, setTab] = useState(article ? 'reader' : 'articles');
  const chats = useArticleChats(article);
  const [missing, setMissing] = useState(false);
  const onArticle = useCallback((a: ArticleView | null) => setMissing(!!a?.missing), []);
  const speech = useReadAloud(article);
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
        <Search className="lib-search-icon" size={14} aria-hidden="true" />
        <input
          type="search"
          placeholder="Filter by title or tag"
          aria-label="Filter articles"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {tree === null ? (
        <p className="muted small lib-none">Loading…</p>
      ) : empty ? (
        <p className="muted small lib-none" data-testid="library-page-empty">
          No folders yet. Add one in <Link to="/settings">Settings → Library</Link>.
        </p>
      ) : (
        <LibraryTree
          tree={tree}
          filter={filter}
          selected={article}
          onTree={setTree}
          onWrite={(at) => setWriting(at)}
        />
      )}
    </div>
  );

  const leftActions = (
    <>
      <span className="spacer" />
      <IconButton
        aria-label="Write an article"
        title="Write an article: the tutor writes one, or a series, from your brief"
        size="sm"
        icon={<PenLine aria-hidden="true" />}
        aria-haspopup="dialog"
        onClick={() => setWriting(null)}
      />
      <IconButton
        aria-label="Refresh"
        title={busy ? 'Refreshing…' : 'Refresh: scan the folders again'}
        size="sm"
        className={busy ? 'lib-refresh busy' : 'lib-refresh'}
        icon={<RefreshCw aria-hidden="true" />}
        onClick={() => void refresh()}
        disabled={busy || empty}
      />
    </>
  );

  // Read aloud (T37, T38): leader keys while an article is open.
  const reading = speech.status !== 'idle';
  useLeaderBindings(
    article && speech.installed !== null
      ? [
          {
            keys: ['p'],
            label: reading ? 'Pause or resume reading aloud' : 'Read aloud',
            group: 'Read aloud',
            run: speech.toggle,
          },
          ...(reading
            ? [
                {
                  keys: ['n'],
                  label: 'Next paragraph',
                  group: 'Read aloud',
                  run: () => speech.skip(1),
                },
                {
                  keys: ['b'],
                  label: 'Previous paragraph',
                  group: 'Read aloud',
                  run: () => speech.skip(-1),
                },
                { keys: ['x'], label: 'Stop reading aloud', group: 'Read aloud', run: speech.stop },
              ]
            : []),
        ]
      : [],
  );

  const middle = article ? (
    <div className="lib-reading">
      <Reader
        id={article}
        version={version}
        onArticle={onArticle}
        onBody={speech.attach}
        layer={(body, html) => <PassageLayer body={body} html={html} chats={chats} onAsk={onAsk} />}
      />
      <ReadAloudBar speech={speech} />
      <ReadAloudOffer speech={speech} />
    </div>
  ) : (
    <div className="lib-placeholder">
      <p className="muted">Choose an article to read.</p>
    </div>
  );

  const right = article ? (
    <ArticleChatPane chats={chats} missing={missing} />
  ) : (
    <div className="lib-placeholder">
      <p className="muted small">Open an article to see its chats.</p>
    </div>
  );

  return (
    <main className="practice library-page">
      {writing !== undefined && (
        <WriteArticle
          tree={tree}
          at={writing}
          onClose={() => {
            setWriting(undefined);
            void invoke('library:tree').then(setTree, () => undefined);
          }}
        />
      )}
      <Panes
        tab={tab}
        onTab={setTab}
        storageKey="library-pane-sizes"
        initialSizes={[24, 52, 24]}
        panes={[
          { id: 'articles', title: 'Articles', content: left, actions: leftActions },
          {
            id: 'reader',
            title: 'Reader',
            content: middle,
            actions: article ? (
              <>
                <span className="spacer" />
                <ReadAloudButton speech={speech} />
              </>
            ) : undefined,
          },
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
