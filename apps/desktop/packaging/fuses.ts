/**
 * Electron fuses for packaged builds (SPEC §10, DECISIONS D-17). Fuses are
 * bits in the Electron binary, flipped once at packaging time; the packaging
 * step (T13) calls `applyFuses` on the packaged app.
 *
 * `npm run check:fuses` flips a temporary copy of the development Electron
 * with the same settings and reads every fuse back.
 *
 * `strictlyRequireAllFuses` makes this fail when an Electron upgrade adds a
 * fuse nobody has decided on yet.
 */
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  flipFuses,
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
  type FuseV1Config,
} from '@electron/fuses';

export const FUSES = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  /** `ELECTRON_RUN_AS_NODE` would turn the app into a plain Node. */
  [FuseV1Options.RunAsNode]: false,
  /** Encrypt the cookie store with an OS-protected key (we keep no cookies; free). */
  [FuseV1Options.EnableCookieEncryption]: true,
  /** `NODE_OPTIONS` could preload code into the main process. */
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  /** `--inspect` and friends would open a debugger on the main process. */
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  /** Check `app.asar` against the hash embedded at build time (macOS, Windows). */
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  /** Load the app only from `app.asar`, so the integrity check covers it. */
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  /** Needs a separate browser-process snapshot we do not build. */
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  /** The UI and execution host use their own protocols, never `file://`. */
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  /** V8's WebAssembly bounds checks by signal handler: Pyodide's speed. */
  [FuseV1Options.WasmTrapHandlers]: true,
} as const satisfies FuseV1Config;

/**
 * Flip the fuses of a packaged app (the `.app` bundle on macOS, the
 * executable elsewhere). Apple Silicon builds that are not signed right after
 * need their ad-hoc signature reset or they will not start.
 */
export async function applyFuses(appPath: string, platform: string, arch: string): Promise<void> {
  await flipFuses(appPath, {
    ...FUSES,
    resetAdHocDarwinSignature: platform === 'darwin' && arch === 'arm64',
  });
}

const STATE: Record<number, string> = {
  [FuseState.ENABLE]: 'on',
  [FuseState.DISABLE]: 'off',
  [FuseState.REMOVED]: 'removed',
  [FuseState.INHERIT]: 'inherit',
};

/** Every fuse in the binary at `appPath`, by name: 'on' | 'off' | … */
export async function readFuses(appPath: string): Promise<Record<string, string>> {
  const wire = await getCurrentFuseWire(appPath);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(wire)) {
    if (key === 'version') continue;
    const name = FuseV1Options[Number(key)] ?? `fuse ${key}`;
    out[name] = STATE[Number(value)] ?? String(value);
  }
  return out;
}

/** The fuses `FUSES` should leave in a binary. */
export function expectedFuses(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(FUSES)) {
    const name = FuseV1Options[Number(key)];
    if (name !== undefined) out[name] = value ? 'on' : 'off';
  }
  return out;
}

/** Copy the development Electron, flip its fuses, read them back. */
async function check(): Promise<boolean> {
  const binary = createRequire(import.meta.url)('electron') as string;
  // The app bundle on macOS (…/dist/Electron.app/Contents/MacOS/Electron),
  // otherwise the folder holding the executable.
  const macApp = binary.match(/^(.*\.app)\//)?.[1];
  const source = macApp ?? dirname(binary);
  const temp = await mkdtemp(join(tmpdir(), 'algotutor-fuses-'));
  try {
    const copy = join(temp, basename(source));
    await cp(source, copy, { recursive: true, verbatimSymlinks: true });
    const target = macApp ? copy : join(copy, basename(binary));
    await applyFuses(target, process.platform, process.arch);
    const actual = await readFuses(target);
    const expected = expectedFuses();
    let ok = true;
    for (const name of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const good = actual[name] === expected[name];
      ok &&= good;
      console.log(`${good ? 'ok  ' : 'FAIL'} ${name}: ${actual[name]} (want ${expected[name]})`);
    }
    console.log(
      `${(await readdir(copy)).length} files copied; ${ok ? 'all fuses as configured' : 'MISMATCH'}`,
    );
    return ok;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--check') {
  check().then(
    (ok) => process.exit(ok ? 0 : 1),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
