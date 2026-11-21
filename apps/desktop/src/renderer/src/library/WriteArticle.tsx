/**
 * "Write an article" (T25, T43; SPEC §15.1): the tutor writes one article,
 * or a series of 2–12 parts, from the user's brief, at a level and length,
 * into the folder the user picks (any library folder or the tutor's own). A
 * series goes in a new folder named after it. While it writes, the dialog
 * lists the parts (planning, writing, saved) and **Stop** ends it, keeping
 * the parts already saved. Opened from the Articles pane's pen button, or
 * **Write here…** on a folder's menu (that folder preselected).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Dialog } from '../components/Dialog';
import { Button, Segmented, Select } from '../components/ui';
import type {
  FolderPlace,
  TreeFolderView,
  TreeView,
  WriteProgressView,
  WriteRequest,
} from '../../../shared/library';
import { stream, type Stream } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { titleCase } from '../lib/format';
import { navigate } from '../lib/router';

const LEVELS: WriteRequest['level'][] = ['beginner', 'intermediate', 'advanced'];
const LENGTHS: WriteRequest['length'][] = ['short', 'medium', 'long'];
const MAX_BRIEF = 4000;
const TUTOR_FOLDER = 'generated';
const TUTOR_FOLDER_NAME = 'Written by the tutor';

interface Place extends FolderPlace {
  label: string;
}

/** Every folder in the tree, as "Vault / Compilers", plus the tutor's folder. */
function writePlaces(tree: TreeView | null): Place[] {
  const out: Place[] = [];
  const walk = (folderId: string, f: TreeFolderView, label: string) => {
    for (const x of f.folders) {
      const l = `${label} / ${x.name}`;
      out.push({ folderId, path: x.path, label: l });
      walk(folderId, x, l);
    }
  };
  for (const f of tree?.folders ?? []) {
    out.push({ folderId: f.id, path: '', label: f.name });
    walk(f.id, f.root, f.name);
  }
  if (!out.some((p) => p.folderId === TUTOR_FOLDER))
    out.push({ folderId: TUTOR_FOLDER, path: '', label: TUTOR_FOLDER_NAME });
  return out;
}

const keyOf = (p: FolderPlace) => `${p.folderId}/${p.path}`;

interface PartState {
  title: string | null;
  state: 'waiting' | 'writing' | 'saved';
  id?: string;
}

interface Run {
  planning: boolean;
  series: string | null;
  parts: PartState[];
  done: boolean;
  /** Why it stopped before the end. */
  stopped: string | null;
}

function apply(run: Run, p: WriteProgressView): Run {
  switch (p.kind) {
    case 'planning':
      return { ...run, planning: true };
    case 'planned':
      return {
        ...run,
        planning: false,
        series: p.title,
        parts: p.parts.map((title) => ({ title, state: 'waiting' })),
      };
    case 'writing': {
      const parts = [...run.parts];
      while (parts.length < p.of) parts.push({ title: null, state: 'waiting' });
      parts[p.part - 1] = {
        ...parts[p.part - 1]!,
        title: p.title ?? parts[p.part - 1]!.title,
        state: 'writing',
      };
      return { ...run, parts };
    }
    case 'saved': {
      const parts = [...run.parts];
      while (parts.length < p.of) parts.push({ title: null, state: 'waiting' });
      parts[p.part - 1] = { title: p.title, state: 'saved', id: p.id };
      return { ...run, parts };
    }
  }
}

export function WriteArticle({
  tree,
  at,
  onClose,
}: {
  tree: TreeView | null;
  /** The folder to save in, preselected; the tutor's folder if `null`. */
  at: FolderPlace | null;
  onClose: () => void;
}) {
  const app = useApp();
  const id = useId();
  const places = writePlaces(tree);
  const [kind, setKind] = useState<'one' | 'series'>('one');
  const [brief, setBrief] = useState('');
  const [parts, setParts] = useState(5);
  const [level, setLevel] = useState<WriteRequest['level']>('intermediate');
  const [length, setLength] = useState<WriteRequest['length']>('medium');
  const [place, setPlace] = useState(() => keyOf(at ?? { folderId: TUTOR_FOLDER, path: '' }));
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<Stream<unknown> | null>(null);

  // Closing the dialog stops the writing; the parts already saved stay.
  useEffect(() => () => live.current?.cancel(), []);

  const busy = run !== null && !run.done;
  const chosen = places.find((p) => keyOf(p) === place) ?? places[places.length - 1]!;

  function start(): void {
    const text = brief.trim();
    if (!text || busy) return;
    setError(null);
    let state: Run = { planning: false, series: null, parts: [], done: false, stopped: null };
    setRun(state);
    const request: WriteRequest = {
      brief: text,
      level,
      length,
      parts: kind === 'series' ? parts : 1,
      to: { folderId: chosen.folderId, path: chosen.path },
    };
    const s = stream('library:write', request, (p) => {
      state = apply(state, p);
      setRun(state);
    });
    live.current = s;
    s.result.then(
      (r) => {
        live.current = null;
        const first = r.articles[0];
        if (!r.stopped && first) {
          onClose();
          app.notify(
            r.articles.length > 1
              ? `Saved the series: ${r.articles.length} articles.`
              : `Saved “${first.title}”.`,
            'success',
          );
          navigate(`/library/${first.id}`);
          return;
        }
        setRun({ ...state, done: true, stopped: r.stopped?.message ?? null });
      },
      (e: unknown) => {
        live.current = null;
        const saved = state.parts.filter((p) => p.state === 'saved').length;
        if (saved > 0) setRun({ ...state, done: true, stopped: errorText(e) });
        else {
          setRun(null);
          setError(errorText(e));
        }
      },
    );
  }

  function stop(): void {
    live.current?.cancel();
  }

  const saved = run?.parts.filter((p) => p.state === 'saved' && p.id) ?? [];
  const footer = busy ? (
    <Button variant="danger" onClick={stop}>
      Stop
    </Button>
  ) : run?.done ? (
    <Button variant="primary" onClick={onClose}>
      Close
    </Button>
  ) : (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={!brief.trim()}>
        {kind === 'series' ? `Write ${parts} articles` : 'Write'}
      </Button>
    </>
  );

  return (
    <Dialog
      titleId={`${id}-title`}
      title="Write an article"
      onClose={onClose}
      wide
      backdropCloses={!busy}
      className="lib-write-dialog"
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
      footer={footer}
    >
      <fieldset className="lib-write-form" disabled={busy || run?.done}>
        <Segmented
          aria-label="What to write"
          options={[
            { value: 'one', label: 'One article' },
            { value: 'series', label: 'A series' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <label>
          {kind === 'series' ? 'What should the series teach?' : 'What should it cover?'}
          <textarea
            value={brief}
            maxLength={MAX_BRIEF}
            rows={6}
            placeholder={
              kind === 'series'
                ? 'e.g. How to build a small compiler in Python, from lexing to code generation. I know basic parsing but not type checking.'
                : 'e.g. Union-find with path compression and union by rank: why it is nearly constant time, with a worked example on a grid.'
            }
            onChange={(e) => setBrief(e.target.value)}
            autoFocus
          />
        </label>
        <span className="muted small lib-write-count" aria-live="off">
          {brief.length} / {MAX_BRIEF}
        </span>
        <div className="lib-write-row">
          {kind === 'series' && (
            <label>
              Articles
              <Select value={parts} onChange={(e) => setParts(Number(e.target.value))}>
                {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label>
            Level
            <Select
              value={level}
              onChange={(e) => setLevel(e.target.value as WriteRequest['level'])}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {titleCase(l)}
                </option>
              ))}
            </Select>
          </label>
          <label>
            {kind === 'series' ? 'Length of each' : 'Length'}
            <Select
              value={length}
              onChange={(e) => setLength(e.target.value as WriteRequest['length'])}
            >
              {LENGTHS.map((l) => (
                <option key={l} value={l}>
                  {titleCase(l)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <label>
          Save in
          <Select value={keyOf(chosen)} onChange={(e) => setPlace(e.target.value)}>
            {places.map((p) => (
              <option key={keyOf(p)} value={keyOf(p)}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
        <p className="muted small">
          The tutor’s AI provider receives the brief.{' '}
          {kind === 'series'
            ? 'The series is saved in a new folder named after it, one file per article, linked in order.'
            : 'The article is saved in that folder.'}{' '}
          Everything the tutor writes is labelled AI-written.
        </p>
      </fieldset>
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      {run && (
        <div className="lib-write-progress" aria-live="polite">
          {run.planning && (
            <p className="small">
              <span className="spinner" aria-hidden="true" /> Planning the series…
            </p>
          )}
          {run.series && <p className="lib-write-series">{run.series}</p>}
          {run.parts.length > 0 && (
            <ol>
              {run.parts.map((p, i) => (
                <li key={i} data-state={p.state}>
                  {p.state === 'writing' ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : p.state === 'saved' ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <span className="lib-write-dot" aria-hidden="true" />
                  )}
                  {p.state === 'saved' && p.id ? (
                    <a
                      href={`#/library/${p.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onClose();
                        navigate(`/library/${p.id}`);
                      }}
                    >
                      {p.title}
                    </a>
                  ) : (
                    <span>{p.title ?? (p.state === 'writing' ? 'Writing…' : 'Waiting')}</span>
                  )}
                  <span className="muted small">
                    {p.state === 'writing' ? 'writing…' : p.state === 'saved' ? 'saved' : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {run.done && (
            <p className="small" role="status">
              {run.stopped ? `Stopped: ${run.stopped} ` : ''}
              {saved.length} of {run.parts.length} saved; the saved ones stay in your library.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
