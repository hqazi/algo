/**
 * "Write an article" (T25, SPEC §15.1): the tutor writes an article on a
 * topic at a level and length; it is saved in the app's own folder, shown
 * under **Written by the tutor** and opened in the reader. Since T32 the
 * Articles pane's header has the **Write an article** icon button that opens
 * this form (`open`).
 */
import { useState } from 'react';
import { Button, Select } from '../components/ui';
import type { WriteArticleRequest } from '../../../shared/library';
import { invoke } from '../ipc';
import { errorText } from '../lib/app-context';
import { titleCase } from '../lib/format';
import { navigate } from '../lib/router';

const LEVELS: WriteArticleRequest['level'][] = ['beginner', 'intermediate', 'advanced'];
const LENGTHS: WriteArticleRequest['length'][] = ['short', 'medium', 'long'];

export function WriteArticle({
  open,
  onClose,
  onWritten,
}: {
  open: boolean;
  onClose: () => void;
  onWritten?: (id: string) => void;
}) {
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
      onClose();
      setTopic('');
      onWritten?.(r.id);
      navigate(`/library/${r.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
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
        <Select
          value={level}
          onChange={(e) => setLevel(e.target.value as WriteArticleRequest['level'])}
          disabled={busy}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {titleCase(l)}
            </option>
          ))}
        </Select>
      </label>
      <label>
        Length
        <Select
          value={length}
          onChange={(e) => setLength(e.target.value as WriteArticleRequest['length'])}
          disabled={busy}
        >
          {LENGTHS.map((l) => (
            <option key={l} value={l}>
              {titleCase(l)}
            </option>
          ))}
        </Select>
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
        <Button type="submit" variant="primary" size="sm" disabled={busy || !topic.trim()}>
          {busy ? 'Writing…' : 'Write'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
