/**
 * The Library's left pane (T22, SPEC §15.6): the folder tree (folders, then
 * articles by title), filtered by title and tags. Restyled in T32
 * (docs/design.md → Library): folders open and close with a chevron button
 * (`aria-expanded`; Tab, Enter and Space as before), folder and file icons,
 * indent guides, the open article as an accent-subtle row. While a filter is
 * typed every matching folder shows open.
 */
import { useState, type ReactNode } from 'react';
import { ChevronRight, FileText, Folder as FolderIcon, FolderOpen, Sparkles } from 'lucide-react';
import type { TreeFolderView, TreeView } from '../../../shared/library';
import { Badge } from '../components/ui';
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

interface Shared {
  selected: string | null;
  /** Folders the user closed, by path. */
  closed: ReadonlySet<string>;
  /** A filter is typed: every folder shows open. */
  filtering: boolean;
  toggle: (path: string) => void;
}

function FolderRow({
  path,
  name,
  root,
  extra,
  shared,
  children,
}: {
  path: string;
  name: string;
  root?: boolean;
  extra?: ReactNode;
  shared: Shared;
  children: ReactNode;
}) {
  const open = shared.filtering || !shared.closed.has(path);
  const Icon = open ? FolderOpen : FolderIcon;
  return (
    <li className={root ? 'lib-folder lib-root' : 'lib-folder'}>
      <button
        type="button"
        className="lib-row lib-folder-row"
        aria-expanded={open}
        onClick={() => shared.toggle(path)}
      >
        <ChevronRight className="lib-chevron" size={14} aria-hidden="true" />
        <Icon className="lib-icon" size={16} aria-hidden="true" />
        <span className="lib-name">{name}</span>
        {extra}
      </button>
      {open && children}
    </li>
  );
}

function Folder({ node, path, shared }: { node: TreeFolderView; path: string; shared: Shared }) {
  return (
    <ul className="lib-tree">
      {node.folders.map((f) => (
        <FolderRow key={`d:${f.name}`} path={`${path}/${f.name}`} name={f.name} shared={shared}>
          <Folder node={f} path={`${path}/${f.name}`} shared={shared} />
        </FolderRow>
      ))}
      {node.articles.map((a) => {
        const active = a.id === shared.selected;
        return (
          <li key={a.id}>
            <a
              href={`#/library/${a.id}`}
              onClick={linkClick}
              className={active ? 'lib-row lib-article active' : 'lib-row lib-article'}
              aria-current={active ? 'page' : undefined}
              title={a.title}
            >
              <FileText className="lib-icon" size={16} aria-hidden="true" />
              <span className="lib-name">{a.title}</span>
              {a.missing && <span className="lib-missing small"> (file missing)</span>}
            </a>
          </li>
        );
      })}
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
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const q = filter.trim().replace(/^#/, '').toLowerCase();
  const folders = tree.folders
    .map((f) => ({ ...f, root: filterFolder(f.root, q) }))
    .filter((f) => !q || f.root !== null);
  if (q && folders.length === 0) return <p className="muted small lib-none">No articles match.</p>;
  const shared: Shared = {
    selected,
    closed,
    filtering: !!q,
    toggle: (path) =>
      setClosed((cur) => {
        const next = new Set(cur);
        if (!next.delete(path)) next.add(path);
        return next;
      }),
  };
  return (
    <ul className="lib-tree lib-roots" aria-label="Library folders">
      {folders.map((f) => (
        <FolderRow
          key={f.id}
          path={f.id}
          name={f.name}
          root
          shared={shared}
          extra={
            f.generated && (
              <Badge tone="accent" className="ai-label">
                <Sparkles size={12} aria-hidden="true" />
                AI-written
              </Badge>
            )
          }
        >
          {f.error && <p className="error-text small lib-error">{f.error}</p>}
          {f.root && <Folder node={f.root} path={f.id} shared={shared} />}
        </FolderRow>
      ))}
    </ul>
  );
}
