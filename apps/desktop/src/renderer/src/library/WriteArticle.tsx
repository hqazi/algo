/**
 * "Write an article" (T25, SPEC §15.1): the tutor writes an article on a
 * topic at a level and length; it is saved in the app's own folder, shown
 * under **Written by the tutor** and opened in the reader.
 */
import { useState } from 'react';
import type { WriteArticleRequest } from '../../../shared/library';
import { invoke } from '../ipc';
import { errorText } from '../lib/app-context';
import { navigate } from '../lib/router';

const LEVELS: WriteArticleRequest['level'][] = ['beginner', 'intermediate', 'advanced'];
const LENGTHS: WriteArticleRequest['length'][] = ['short', 'medium', 'long'];

export function WriteArticle({ onWritten }: { onWritten?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<WriteArticleRequest['level']>('intermediate');
  const [length, setLength] = useState<WriteArticleRequest['length']>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function write(): Promise<void> {
    const t = topic.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await invoke('library:write-article', { topic: t, level, length });
      setOpen(false);
      setTopic('');
      onWritten?.(r.id);
      navigate(`/library/${r.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button type="button" className="small-button lib-write" onClick={() => setOpen(true)}>
        Write an article
      </button>
    );
  return (
    <form
      className="lib-write-form"
      aria-label="Write an article"
      onSubmit={(e) => {
        e.preventDefault();
        void write();
      }}
    >
      <label>
        Topic
        <input
          value={topic}
          maxLength={300}
          placeholder="e.g. Union-find with path compression"
          onChange={(e) => setTopic(e.target.value)}
          disabled={busy}
          autoFocus
        />
      </label>
      <label>
        Level
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as WriteArticleRequest['level'])}
          disabled={busy}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Length
        <select
          value={length}
          onChange={(e) => setLength(e.target.value as WriteArticleRequest['length'])}
          disabled={busy}
        >
          {LENGTHS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        The tutor’s AI provider receives the topic. The article is saved in the app’s own folder and
        labelled AI-written.
      </p>
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      <div className="lib-write-actions">
        <button type="submit" className="primary small-button" disabled={busy || !topic.trim()}>
          {busy ? 'Writing…' : 'Write'}
        </button>
        <button
          type="button"
          className="small-button"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
