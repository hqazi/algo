/**
 * The tree's dialogs (T42): **New folder** (a name), **Move to…** (every
 * folder it may go to, as an indented list of choices) and **Delete** (a
 * confirm that says what happens to the file and its chats).
 */
import { useId, useState } from 'react';
import { Folder } from 'lucide-react';
import { entryNameProblem } from '@algo/core';
import type {
  FolderPlace,
  LibraryItemView,
  TreeFolderView,
  TreeView,
} from '../../../shared/library';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/ui';
import { canDrop } from './tree-moves';

export type TreeDialogState =
  | { kind: 'new-folder'; at: FolderPlace; label: string }
  | { kind: 'move'; item: LibraryItemView; from: FolderPlace; label: string }
  | { kind: 'delete'; item: LibraryItemView; label: string; missing: boolean };

interface Props {
  state: TreeDialogState;
  tree: TreeView;
  onClose: () => void;
  /** Each resolves `true` once done (the dialog then closes). */
  onNewFolder: (at: FolderPlace, name: string) => Promise<boolean>;
  onMove: (item: LibraryItemView, to: FolderPlace) => Promise<boolean>;
  onDelete: (item: LibraryItemView) => Promise<boolean>;
}

export function TreeDialog(props: Props) {
  const { state } = props;
  if (state.kind === 'new-folder') return <NewFolder {...props} state={state} />;
  if (state.kind === 'move') return <MoveTo {...props} state={state} />;
  return <ConfirmDelete {...props} state={state} />;
}

function NewFolder({
  state,
  onClose,
  onNewFolder,
}: Props & { state: Extract<TreeDialogState, { kind: 'new-folder' }> }) {
  const id = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = name ? entryNameProblem(name.trim()) : null;
  return (
    <Dialog
      titleId={`${id}-title`}
      title="New folder"
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || problem || busy) return;
        setBusy(true);
        void onNewFolder(state.at, name.trim()).finally(() => setBusy(false));
      }}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || !!problem || busy}>
            Create
          </Button>
        </>
      }
    >
      <label className="lib-dialog-field">
        Name
        <input
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!problem}
          aria-describedby={`${id}-where`}
          autoFocus
        />
      </label>
      {problem && (
        <p className="error-text small" role="alert">
          {problem}
        </p>
      )}
      <p className="muted small" id={`${id}-where`}>
        Inside “{state.label}”, on this computer.
      </p>
    </Dialog>
  );
}

interface Place extends FolderPlace {
  name: string;
  depth: number;
}

function places(tree: TreeView): Place[] {
  const out: Place[] = [];
  const walk = (folderId: string, f: TreeFolderView, depth: number) => {
    for (const x of f.folders) {
      out.push({ folderId, path: x.path, name: x.name, depth });
      walk(folderId, x, depth + 1);
    }
  };
  for (const f of tree.folders) {
    out.push({ folderId: f.id, path: '', name: f.name, depth: 0 });
    walk(f.id, f.root, 1);
  }
  return out;
}

function MoveTo({
  state,
  tree,
  onClose,
  onMove,
}: Props & { state: Extract<TreeDialogState, { kind: 'move' }> }) {
  const id = useId();
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = places(tree).filter((p) => canDrop({ item: state.item, from: state.from }, p));
  const key = (p: FolderPlace) => `${p.folderId}/${p.path}`;
  const chosen = choices.find((p) => key(p) === to);
  return (
    <Dialog
      titleId={`${id}-title`}
      title={`Move “${state.label}”`}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosen || busy) return;
        setBusy(true);
        void onMove(state.item, { folderId: chosen.folderId, path: chosen.path }).finally(() =>
          setBusy(false),
        );
      }}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!chosen || busy}>
            Move
          </Button>
        </>
      }
    >
      {choices.length === 0 ? (
        <p className="muted small">There is no other folder to move it to.</p>
      ) : (
        <fieldset className="lib-move-list">
          <legend className="small muted">Move to</legend>
          {choices.map((p) => (
            <label key={key(p)} style={{ paddingLeft: `${p.depth * 16}px` }}>
              <input
                type="radio"
                name={`${id}-to`}
                checked={to === key(p)}
                onChange={() => setTo(key(p))}
              />
              <Folder size={14} aria-hidden="true" />
              <span className={p.depth === 0 ? 'lib-move-root' : undefined}>{p.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="muted small">
        Chats on its articles move with it. Images the article links to by a relative path may not
        be found from the new place.
      </p>
    </Dialog>
  );
}

function ConfirmDelete({
  state,
  onClose,
  onDelete,
}: Props & { state: Extract<TreeDialogState, { kind: 'delete' }> }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const folder = state.item.kind === 'folder';
  const what = folder ? 'folder' : 'article';
  return (
    <Dialog
      titleId={`${id}-title`}
      title={`Delete “${state.label}”?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} autoFocus>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onDelete(state.item).finally(() => setBusy(false));
            }}
          >
            {state.missing ? 'Delete chats' : 'Move to trash'}
          </Button>
        </>
      }
    >
      {state.missing ? (
        <p>The file is already gone. This deletes the article from the library with its chats.</p>
      ) : (
        <p>
          The {what}
          {folder ? ' and everything in it' : ''} goes to your computer’s trash, where you can
          restore it. Articles with chats stay listed as “file missing” so their chats are kept.
        </p>
      )}
    </Dialog>
  );
}
