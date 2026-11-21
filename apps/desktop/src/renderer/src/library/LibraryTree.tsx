/**
 * The Library's left pane (T22, SPEC §15.6): the folder tree (folders, then
 * articles by title), filtered by title and tags. Restyled in T32
 * (docs/design.md → Library): folders open and close with a chevron button
 * (`aria-expanded`; Tab, Enter and Space as before), folder and file icons,
 * indent guides, the open article as an accent-subtle row. While a filter is
 * typed every matching folder shows open.
 *
 * T42: each row has a menu (**New folder**, **Move to…**, **Delete**), and
 * articles and folders can be dragged onto a folder (dropping anywhere in a
 * folder's open subtree lands in the innermost folder). Library folders
 * themselves can only get new folders. The changes run in main
 * (`library:create-folder`, `library:move`, `library:delete`), which sends
 * back the tree.
 */
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { FolderPlace, TreeFolderView, TreeView } from '../../../shared/library';
import { Badge, Menu, type MenuItem } from '../components/ui';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { linkClick, navigate } from '../lib/router';
import { TreeDialog, type TreeDialogState } from './TreeDialogs';
import { canDrop, parentOf, type Moving } from './tree-moves';

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

type Dragged = Moving;

interface Shared {
  selected: string | null;
  /** Folders the user closed, by `folderId/path`. */
  closed: ReadonlySet<string>;
  /** A filter is typed: every folder shows open. */
  filtering: boolean;
  toggle: (key: string) => void;
  /** The folder a drag is over, by `folderId/path`. */
  over: string | null;
  setOver: (key: string | null) => void;
  dragged: () => Dragged | null;
  setDragged: (d: Dragged | null) => void;
  move: (d: Dragged, to: FolderPlace) => void;
  open: (d: TreeDialogState) => void;
}

function hasArticle(t: TreeView, id: string): boolean {
  const walk = (f: TreeFolderView): boolean =>
    f.articles.some((a) => a.id === id) || f.folders.some(walk);
  return t.folders.some((f) => walk(f.root));
}

const placeKey = (p: FolderPlace) => `${p.folderId}/${p.path}`;

function dragStart(shared: Shared, d: Dragged) {
  return (e: DragEvent) => {
    shared.setDragged(d);
    e.dataTransfer.effectAllowed = 'move';
    // Some platforms start a drag only with data set.
    e.dataTransfer.setData('text/plain', '');
    e.stopPropagation();
  };
}

function FolderRow({
  folderId,
  node,
  root,
  extra,
  shared,
  children,
}: {
  folderId: string;
  node: TreeFolderView;
  root?: boolean;
  extra?: ReactNode;
  shared: Shared;
  children: ReactNode;
}) {
  const place: FolderPlace = { folderId, path: node.path };
  const key = placeKey(place);
  const open = shared.filtering || !shared.closed.has(key);
  const Icon = open ? FolderOpen : FolderIcon;
  const label = node.name;
  const self: Dragged | null = root
    ? null
    : {
        item: { kind: 'folder', folderId, path: node.path },
        from: { folderId, path: parentOf(node.path) },
      };
  const items: MenuItem[] = [
    {
      label: 'New folder',
      icon: <FolderPlus size={14} aria-hidden="true" />,
      onSelect: () => shared.open({ kind: 'new-folder', at: place, label }),
    },
    ...(self
      ? [
          {
            label: 'Move to…',
            icon: <FolderInput size={14} aria-hidden="true" />,
            onSelect: () => shared.open({ kind: 'move', item: self.item, from: self.from, label }),
          },
          {
            label: 'Delete',
            icon: <Trash2 size={14} aria-hidden="true" />,
            danger: true,
            onSelect: () => shared.open({ kind: 'delete', item: self.item, label, missing: false }),
          },
        ]
      : []),
  ];
  return (
    <li
      className={['lib-folder', root ? 'lib-root' : '', shared.over === key ? 'lib-drop' : '']
        .filter(Boolean)
        .join(' ')}
      onDragOver={(e) => {
        const d = shared.dragged();
        if (!d) return;
        e.stopPropagation();
        if (!canDrop(d, place)) {
          if (shared.over !== null) shared.setOver(null);
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (shared.over !== key) shared.setOver(key);
      }}
      onDrop={(e) => {
        const d = shared.dragged();
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        shared.setDragged(null);
        shared.setOver(null);
        if (canDrop(d, place)) shared.move(d, place);
      }}
    >
      <div className="lib-row-wrap">
        <button
          type="button"
          className="lib-row lib-folder-row"
          aria-expanded={open}
          onClick={() => shared.toggle(key)}
          draggable={!!self}
          onDragStart={self ? dragStart(shared, self) : undefined}
        >
          <ChevronRight className="lib-chevron" size={14} aria-hidden="true" />
          <Icon className="lib-icon" size={16} aria-hidden="true" />
          <span className="lib-name">{node.name}</span>
          {extra}
        </button>
        <span className="lib-row-menu">
          <Menu label={`Actions for ${node.name}`} items={items} />
        </span>
      </div>
      {open && children}
    </li>
  );
}

function Folder({
  folderId,
  node,
  shared,
}: {
  folderId: string;
  node: TreeFolderView;
  shared: Shared;
}) {
  const here: FolderPlace = { folderId, path: node.path };
  return (
    <ul className="lib-tree">
      {node.folders.map((f) => (
        <FolderRow key={`d:${f.name}`} folderId={folderId} node={f} shared={shared}>
          <Folder folderId={folderId} node={f} shared={shared} />
        </FolderRow>
      ))}
      {node.articles.map((a) => {
        const active = a.id === shared.selected;
        const self: Dragged = { item: { kind: 'article', id: a.id }, from: here };
        const items: MenuItem[] = [
          {
            label: 'Move to…',
            icon: <FolderInput size={14} aria-hidden="true" />,
            disabled: a.missing,
            title: a.missing ? 'The file is missing' : undefined,
            onSelect: () =>
              shared.open({ kind: 'move', item: self.item, from: here, label: a.title }),
          },
          {
            label: 'Delete',
            icon: <Trash2 size={14} aria-hidden="true" />,
            danger: true,
            onSelect: () =>
              shared.open({ kind: 'delete', item: self.item, label: a.title, missing: a.missing }),
          },
        ];
        return (
          <li key={a.id}>
            <div className="lib-row-wrap">
              <a
                href={`#/library/${a.id}`}
                onClick={linkClick}
                className={active ? 'lib-row lib-article active' : 'lib-row lib-article'}
                aria-current={active ? 'page' : undefined}
                title={a.title}
                draggable={!a.missing}
                onDragStart={a.missing ? undefined : dragStart(shared, self)}
              >
                <FileText className="lib-icon" size={16} aria-hidden="true" />
                <span className="lib-name">{a.title}</span>
                {a.generated && (
                  <Sparkles className="lib-ai-mark" size={12} aria-label="AI-written" role="img" />
                )}
                {a.missing && <span className="lib-missing small"> (file missing)</span>}
              </a>
              <span className="lib-row-menu">
                <Menu label={`Actions for ${a.title}`} items={items} />
              </span>
            </div>
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
  onTree,
}: {
  tree: TreeView;
  filter: string;
  selected: string | null;
  /** T42: the tree main sends back after a change. */
  onTree?: (tree: TreeView) => void;
}) {
  const app = useApp();
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [over, setOver] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TreeDialogState | null>(null);
  const drag = useRef<Dragged | null>(null);

  async function run(
    change: () => Promise<TreeView>,
    done?: (t: TreeView) => void,
  ): Promise<boolean> {
    try {
      const t = await change();
      onTree?.(t);
      done?.(t);
      return true;
    } catch (e) {
      app.notify(errorText(e), 'error');
      return false;
    }
  }

  const q = filter.trim().replace(/^#/, '').toLowerCase();
  const folders = tree.folders
    .map((f) => ({ ...f, root: filterFolder(f.root, q) }))
    .filter((f) => !q || f.root !== null);
  const shared: Shared = {
    selected,
    closed,
    filtering: !!q,
    toggle: (key) =>
      setClosed((cur) => {
        const next = new Set(cur);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    over,
    setOver,
    dragged: () => drag.current,
    setDragged: (d) => {
      drag.current = d;
    },
    move: (d, to) => void run(() => invoke('library:move', { item: d.item, to })),
    open: setDialog,
  };

  return (
    <>
      {q && folders.length === 0 ? (
        <p className="muted small lib-none">No articles match.</p>
      ) : (
        <ul
          className="lib-tree lib-roots"
          aria-label="Library folders"
          onDragEnd={() => {
            drag.current = null;
            setOver(null);
          }}
        >
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              folderId={f.id}
              node={{ folders: [], articles: [], ...f.root, name: f.name, path: '' }}
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
              {f.root && <Folder folderId={f.id} node={f.root} shared={shared} />}
            </FolderRow>
          ))}
        </ul>
      )}
      {dialog && (
        <TreeDialog
          state={dialog}
          tree={tree}
          onClose={() => setDialog(null)}
          onNewFolder={(at, name) =>
            run(
              () => invoke('library:create-folder', { at, name }),
              () => setDialog(null),
            )
          }
          onMove={(item, to) =>
            run(
              () => invoke('library:move', { item, to }),
              () => setDialog(null),
            )
          }
          onDelete={(item) =>
            run(
              () => invoke('library:delete', { item }),
              (t) => {
                setDialog(null);
                // The open article left the library with it: close the reader.
                if (selected && !hasArticle(t, selected)) navigate('/library');
              },
            )
          }
        />
      )}
    </>
  );
}
