/**
 * The Library page (T22, SPEC §15.6): folder tree with filter and Refresh,
 * the reader, and the chat pane (a placeholder until T24), in the practice
 * view's resizable panes. While the page is open, main rescans on file
 * changes (`library:watch`) and sends the tree after each scan.
 */
import { useEffect, useState } from 'react';
import type { TreeView } from '../../../shared/library';
import { Link } from '../components/Link';
import { Panes } from '../components/Panes';
import { invoke, stream } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { LibraryTree } from '../library/LibraryTree';
import { Reader } from '../library/Reader';

export function LibraryPage({ article }: { article: string | null }) {
  const app = useApp();
  const [tree, setTree] = useState<TreeView | null>(null);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(article ? 'reader' : 'articles');

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
        <button type="button" onClick={() => void refresh()} disabled={busy || empty}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
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

  const middle = article ? (
    <Reader id={article} version={version} />
  ) : (
    <p className="muted reader-pad">Choose an article to read.</p>
  );

  const right = (
    <div className="reader-pad">
      <h2 className="small">Chats</h2>
      <p className="muted small" data-testid="chats-placeholder">
        Chats about passages of this article will appear here.
      </p>
    </div>
  );

  return (
    <main className="practice library-page">
      <Panes
        tab={tab}
        onTab={setTab}
        storageKey="library-pane-sizes"
        initialSizes={[24, 52, 24]}
        panes={[
          { id: 'articles', title: 'Articles', content: left },
          { id: 'reader', title: 'Reader', content: middle },
          { id: 'chats', title: 'Chats', content: right },
        ]}
      />
    </main>
  );
}
