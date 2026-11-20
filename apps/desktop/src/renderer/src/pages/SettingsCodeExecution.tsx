/**
 * Settings → Code execution (SPEC §6.5, §8; T18): Python's status, the time
 * scale, and how Rust and Go run: the local toolchains (no sandbox) or a
 * detected container runtime. Only running runtimes can be chosen; a missing
 * one links to the install guide, a stopped one shows the command that starts it.
 * The app never installs or starts anything: Recheck detects again, Pull /
 * Update fetches the runner image, Test sandbox runs hello world.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExecStatusView, RuntimesView, SandboxResultView } from '../../../shared/settings';
import { invoke, stream, type Stream } from '../ipc';
import { errorText, useApp } from '../lib/app-context';

const TIME_SCALES = [0.5, 1, 1.5, 2, 3, 5, 10];

type RuntimeRow = RuntimesView['runtimes'][number];
type ContainerRuntime = RuntimeRow['runtime'];

const RUNTIME_NAMES: Record<ContainerRuntime, string> = { podman: 'Podman', docker: 'Docker' };

function InstallHelp({ topic }: { topic: 'container' | 'toolchains' }) {
  const app = useApp();
  return (
    <button
      type="button"
      className="link"
      onClick={() =>
        void invoke('exec:install-help', { topic }).catch((e: unknown) =>
          app.notify(errorText(e), 'error'),
        )
      }
    >
      How to install →
    </button>
  );
}

function PythonStatus() {
  const [status, setStatus] = useState<ExecStatusView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    void invoke('exec:status').then(setStatus, (e: unknown) => setFailed(errorText(e)));
  }, []);
  const py = status?.python;
  const versions = py ? Object.entries(py.versions) : [];
  return (
    <dl className="kv" data-testid="exec-status">
      <dt>Python</dt>
      <dd>
        {failed
          ? `Unknown (${failed})`
          : !py
            ? 'Checking… (the first check starts Python, which takes a few seconds)'
            : py.available
              ? `Ready · Pyodide${versions.length ? ` (${versions.map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`
              : `Not available: ${py.reason ?? 'unknown reason'}`}
      </dd>
    </dl>
  );
}

function stateText(r: RuntimeRow): string {
  if (r.state === 'running') {
    return ['Running', r.version, r.endpoint].filter(Boolean).join(' · ');
  }
  if (r.state === 'installed-not-running') return 'Installed, not running';
  return 'Not found';
}

interface PullState {
  line: string;
  layers: { done: number; total: number } | null;
}

function RuntimeTools({ row, onChanged }: { row: RuntimeRow; onChanged: () => void }) {
  const [pull, setPull] = useState<PullState | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<SandboxResultView | null>(null);
  const handle = useRef<Stream<{ ok: boolean; message: string }> | null>(null);
  useEffect(() => () => handle.current?.cancel(), []);
  const name = RUNTIME_NAMES[row.runtime];

  async function startPull(): Promise<void> {
    setOutcome(null);
    setPull({ line: 'Starting…', layers: null });
    const s = stream('exec:pull', { runtime: row.runtime }, (e) => setPull(e));
    handle.current = s;
    try {
      setOutcome(await s.result);
    } catch (e) {
      setOutcome({ ok: false, message: errorText(e) });
    } finally {
      handle.current = null;
      setPull(null);
      onChanged();
    }
  }

  async function runTest(): Promise<void> {
    setTesting(true);
    setTest(null);
    try {
      setTest(await invoke('exec:test', { runtime: row.runtime }));
    } catch (e) {
      setTest({ ok: false, checks: [{ language: 'rust', ok: false, message: errorText(e) }] });
    } finally {
      setTesting(false);
    }
  }

  const present = row.image.present === true;
  return (
    <div className="runtime-tools" data-testid={`runtime-tools-${row.runtime}`}>
      <p className="small">
        Runner image <code>{row.image.name}</code>:{' '}
        {present ? 'on this computer' : 'not pulled yet'}
      </p>
      <div className="inline-actions">
        {pull ? (
          <button type="button" onClick={() => handle.current?.cancel()}>
            Cancel pull
          </button>
        ) : (
          <button type="button" onClick={() => void startPull()} disabled={testing}>
            {present ? `Update image (${name})` : `Pull image (${name})`}
          </button>
        )}
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={testing || !!pull || !present}
          title={present ? undefined : 'Pull the image first'}
        >
          {testing ? 'Testing…' : `Test sandbox (${name})`}
        </button>
      </div>
      {pull && (
        <p className="small muted" role="status" data-testid="pull-progress">
          {pull.layers ? `Layers ${pull.layers.done}/${pull.layers.total} · ` : ''}
          {pull.line}
        </p>
      )}
      {outcome && (
        <p className={`small ${outcome.ok ? 'pass-text' : 'error-text'}`} role="status">
          {outcome.ok ? 'Done: ' : 'Pull failed: '}
          {outcome.message}
        </p>
      )}
      {test && (
        <ul className="list small" data-testid="sandbox-result">
          {test.checks.map((c) => (
            <li key={c.language} className={c.ok ? 'pass-text' : 'error-text'}>
              {c.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RustGo() {
  const app = useApp();
  const [view, setView] = useState<RuntimesView | null>(null);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const detect = useCallback(async (recheck: boolean) => {
    setChecking(true);
    try {
      setView(await invoke('exec:runtimes', { recheck }));
      setFailed(null);
    } catch (e) {
      setFailed(errorText(e));
    } finally {
      setChecking(false);
    }
  }, []);
  // Detect when Settings opens (SPEC §6.5).
  useEffect(() => {
    let live = true;
    void invoke('exec:runtimes', { recheck: false })
      .then(
        (v) => live && setView(v),
        (e: unknown) => live && setFailed(errorText(e)),
      )
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, []);

  const selected = app.settings?.settings.execution.runtime ?? 'local';
  async function choose(runtime: 'local' | ContainerRuntime): Promise<void> {
    if (runtime === selected) return;
    // Only a running runtime can be chosen (main refuses the rest too).
    const row = view?.runtimes.find((r) => r.runtime === runtime);
    if (runtime !== 'local' && row?.state !== 'running') return;
    await app.updateSettings({ execution: { runtime } });
    void detect(false);
  }

  return (
    <div data-testid="rust-go">
      <h3>Rust and Go</h3>
      {failed && <p className="error-text small">Could not detect: {failed}</p>}
      {!view && !failed && <p className="muted small">Checking…</p>}
      {view?.notice && (
        <p className="warning small" role="alert" data-testid="exec-notice">
          {view.notice}
        </p>
      )}
      {view && (
        <fieldset className="runtime-list">
          <legend>Run Rust and Go with</legend>
          <div className="runtime" data-testid="runtime-local">
            <label className="radio">
              <input
                type="radio"
                name="runtime"
                value="local"
                checked={selected === 'local'}
                onChange={() => void choose('local')}
              />{' '}
              Local toolchains (no sandbox)
            </label>
            <ul className="list small">
              {view.toolchains.map((t) => (
                <li key={t.tool}>
                  <code>{t.tool}</code>:{' '}
                  {t.found ? (
                    `${t.version ?? '?'}`
                  ) : (
                    <>
                      not found <InstallHelp topic="toolchains" />
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted small">
              No sandbox: your code runs as you, with access to your files and the network, and
              memory limits are not enforced.
            </p>
          </div>
          {view.runtimes.map((r) => {
            const running = r.state === 'running';
            return (
              <div className="runtime" key={r.runtime} data-testid={`runtime-${r.runtime}`}>
                <label className="radio">
                  <input
                    type="radio"
                    name="runtime"
                    value={r.runtime}
                    checked={selected === r.runtime}
                    disabled={!running}
                    onChange={() => void choose(r.runtime)}
                  />{' '}
                  {RUNTIME_NAMES[r.runtime]}{' '}
                  <span className="muted small" data-testid={`runtime-state-${r.runtime}`}>
                    ({stateText(r)})
                  </span>
                </label>
                {r.state === 'not-found' && (
                  <p className="small">
                    Not installed. <InstallHelp topic="container" />
                  </p>
                )}
                {r.state === 'installed-not-running' && (
                  <>
                    {r.start_hint && (
                      <p className="small">
                        Start it, then recheck: <code>{r.start_hint}</code>
                      </p>
                    )}
                    {r.reason && <p className="muted small path">{r.reason}</p>}
                  </>
                )}
                {running && <RuntimeTools row={r} onChanged={() => void detect(false)} />}
              </div>
            );
          })}
        </fieldset>
      )}
      {view &&
        selected !== 'local' &&
        !view.runtimes.some((r) => r.runtime === selected && r.state === 'running') && (
          <p className="warning small">
            {RUNTIME_NAMES[selected]} is not running, so Rust and Go run with the local toolchains.
          </p>
        )}
      <div className="inline-actions">
        <button type="button" onClick={() => void detect(true)} disabled={checking}>
          {checking ? 'Checking…' : 'Recheck runtimes'}
        </button>
      </div>
      <p className="muted small">
        The app only detects runtimes and toolchains; it never installs or starts them.
      </p>
    </div>
  );
}

export function ExecutionSection() {
  const app = useApp();
  const s = app.settings?.settings.execution;
  if (!s) return null;
  const scales = TIME_SCALES.includes(s.timeScale)
    ? TIME_SCALES
    : [...TIME_SCALES, s.timeScale].sort((a, b) => a - b);
  return (
    <section className="card" aria-labelledby="settings-exec">
      <h2 id="settings-exec">Code execution</h2>
      <PythonStatus />
      <p className="muted small">
        Python runs inside the app with Pyodide, which has no access to your files or the network.
      </p>
      <RustGo />
      <label className="field">
        Time limits
        <select
          aria-label="Time limit multiplier"
          value={String(s.timeScale)}
          onChange={(e) =>
            void app.updateSettings({ execution: { timeScale: Number(e.target.value) } })
          }
        >
          {scales.map((x) => (
            <option key={x} value={String(x)}>
              {x === 1 ? '×1 (normal)' : `×${x}`}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">Raise this on a slow computer if correct solutions time out.</p>
    </section>
  );
}
