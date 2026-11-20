/**
 * The Library's left pane (T22, SPEC §15.6): the folder tree (folders, then
 * articles by title), filtered by title and tags.
 */
import type { TreeFolderView, TreeView } from '../../../shared/library';
import { linkClick } from '../lib/router';

/** The folder with only the articles that match `q` (lower case); `null` if none do. */
function filterFolder(f: TreeFolderView, q: string): TreeFolderView | null {
  if (!q) return f;
  const articles = f.articles.filter(
    (a) => a.title.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q)),
  );
  const folders = f.folders
    .map((x) => filterFolder(x, q))
    .filter((x): x is TreeFolderView => x !== null);
  return articles.length || folders.length ? { ...f, folders, articles } : null;
}

function Folder({ node, selected }: { node: TreeFolderView; selected: string | null }) {
  return (
    <ul className="lib-tree">
      {node.folders.map((f) => (
        <li key={`d:${f.name}`}>
          <details open>
            <summary>{f.name}</summary>
            <Folder node={f} selected={selected} />
          </details>
        </li>
      ))}
      {node.articles.map((a) => (
        <li key={a.id}>
          <a
            href={`#/library/${a.id}`}
            onClick={linkClick}
            className={a.id === selected ? 'lib-article active' : 'lib-article'}
            aria-current={a.id === selected ? 'page' : undefined}
          >
            {a.title}
          </a>
          {a.missing && <span className="small muted"> (file missing)</span>}
        </li>
      ))}
    </ul>
  );
}

export function LibraryTree({
  tree,
  filter,
  selected,
}: {
  tree: TreeView;
  filter: string;
  selected: string | null;
}) {
  const q = filter.trim().replace(/^#/, '').toLowerCase();
  const folders = tree.folders
    .map((f) => ({ ...f, root: filterFolder(f.root, q) }))
    .filter((f) => !q || f.root !== null);
  if (q && folders.length === 0) return <p className="muted small">No articles match.</p>;
  return (
    <ul className="lib-tree lib-roots" aria-label="Library folders">
      {folders.map((f) => (
        <li key={f.id}>
          <details open>
            <summary>
              {f.name}
              {f.generated && <span className="pill ai-label">AI-written</span>}
            </summary>
            {f.error && <p className="error-text small">{f.error}</p>}
            {f.root && <Folder node={f.root} selected={selected} />}
          </details>
        </li>
      ))}
    </ul>
  );
}
