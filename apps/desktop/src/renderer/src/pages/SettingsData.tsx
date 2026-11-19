/**
 * Settings → Data (SPEC §4.5, §8): open the data folder, export, import,
 * reset. File choosers and confirmations are native dialogs shown by main,
 * which also exports the current data to the backups folder before an
 * import or reset.
 */
import { useEffect, useState } from 'react';
import { invoke } from '../ipc';
import { errorText, useApp } from '../lib/app-context';

export function DataSection() {
  const app = useApp();
  const [info, setInfo] = useState<{ dir: string; backups: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    void invoke('data:info').then(setInfo, () => undefined);
  }, []);

  async function run(name: string, fn: () => Promise<void>): Promise<void> {
    setBusy(name);
    try {
      await fn();
    } catch (err) {
      app.notify(errorText(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  const exportData = () =>
    run('export', async () => {
      const r = await invoke('data:export');
      if (r.path) app.notify(`Exported to ${r.path}`, 'success');
    });
  const importData = () =>
    run('import', async () => {
      const r = await invoke('data:import');
      if (r.staged) setRestarting(true);
    });
  const reset = (scope: 'progress' | 'everything') =>
    run(scope, async () => {
      const r = await invoke('data:reset', { scope });
      if (!r.done) return;
      if (r.restarting) {
        setRestarting(true);
        return;
      }
      await app.refresh();
      app.notify(`Progress reset. A backup is at ${r.backup ?? 'the backups folder'}.`, 'success');
    });

  if (restarting)
    return (
      <section className="card" aria-labelledby="settings-data">
        <h2 id="settings-data">Data</h2>
        <p role="status">Restarting to finish…</p>
      </section>
    );

  return (
    <section className="card" aria-labelledby="settings-data">
      <h2 id="settings-data">Data</h2>
      {info && (
        <dl className="kv">
          <dt>Data folder</dt>
          <dd className="path" data-testid="data-dir">
            {info.dir}
          </dd>
          <dt>Backups</dt>
          <dd className="path">{info.backups}</dd>
        </dl>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={!!busy}
          onClick={() =>
            void run('open', async () => {
              await invoke('data:open-folder');
            })
          }
        >
          Open data folder
        </button>
        <button type="button" disabled={!!busy} onClick={() => void exportData()}>
          {busy === 'export' ? 'Exporting…' : 'Export…'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => void importData()}>
          {busy === 'import' ? 'Importing…' : 'Import…'}
        </button>
      </div>
      <p className="muted small">
        An export is one zip with your progress, chats, solutions, settings, your own problems and
        explanations. It never holds the API key.
      </p>
      <h3>Reset</h3>
      <div className="actions">
        <button
          type="button"
          className="danger"
          disabled={!!busy}
          onClick={() => void reset('progress')}
        >
          Reset progress…
        </button>
        <button
          type="button"
          className="danger"
          disabled={!!busy}
          onClick={() => void reset('everything')}
        >
          Reset everything…
        </button>
      </div>
      <p className="muted small">
        Both ask first and export your data to the backups folder before changing anything.
      </p>
    </section>
  );
}
