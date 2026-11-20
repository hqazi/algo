/**
 * Export, import and reset (SPEC §4.5) over a real `tutor.db` in a temp data
 * folder: export then import round-trips progress, chats, settings and
 * workspace files; bad archives are refused before anything changes.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppStorage, type AppStorage } from '../storage';
import { applyPending, ArchiveError, checkEntryName, readArchive, stageImport } from './archive';
import { DataService, type DataUi } from './index';

const NOW = '2026-11-19T14:30:00.000Z';
let root: string;
const opened: AppStorage[] = [];

function open(dir: string): AppStorage {
  const s = openAppStorage(dir);
  opened.push(s);
  return s;
}

async function close(s: AppStorage): Promise<void> {
  await s.close();
  opened.splice(opened.indexOf(s), 1);
}

function fakeUi(over: Partial<DataUi> = {}): DataUi & { restarts: number } {
  const ui = {
    restarts: 0,
    chooseExportPath: () => Promise.resolve(null),
    chooseImportFile: () => Promise.resolve(null),
    confirm: () => Promise.resolve(true),
    openFolder: () => Promise.resolve(true),
    restart: () => {
      ui.restarts += 1;
    },
    ...over,
  };
  return ui;
}

function service(s: AppStorage, ui: DataUi = fakeUi()): DataService {
  return new DataService({
    paths: s.paths,
    storage: s.storage,
    appVersion: '0.1.0',
    now: () => NOW,
    ui,
  });
}

/** A learner with a profile, a solved attempt with a hint and a run, a chat, a solution file. */
async function seed(s: AppStorage): Promise<void> {
  await s.storage.write((db) => {
    db.saveProfile({
      goal: 'interview',
      interviewDate: '2027-01-15',
      experience: 'intermediate',
      comfort: { basics: 'solid' },
      hintPreference: 'struggle',
      focusTopic: 'hashing',
      language: 'python',
      onboarded: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const a = db.createAttempt({ slug: 'pair-with-target', language: 'python', startedAt: NOW });
    db.addHint({ attemptId: a.id, level: 1, givenAt: NOW });
    db.addTestRun({
      attemptId: a.id,
      kind: 'submit',
      report: { big: 9223372036854775807n, total: 3 },
      createdAt: NOW,
    });
    db.updateAttempt(a.id, {
      finishedAt: NOW,
      passed: 3,
      total: 3,
      outcome: 'with_hints',
      hintsUsed: 1,
    });
    db.saveTopicProgress({ topic: 'hashing', level: 'learning', unaidedSolves: 0, updatedAt: NOW });
    db.saveThread({
      id: 'home',
      backend: 'fake',
      backendState: {},
      createdAt: NOW,
      archivedAt: null,
    });
    db.appendMessage({
      threadId: 'home',
      role: 'user',
      content: { text: 'hello' },
      createdAt: NOW,
    });
  });
  s.settings.update({ ui: { theme: 'dark' }, tutor: { effort: 'high' } });
  mkdirSync(join(s.paths.workspace, 'pair-with-target'), { recursive: true });
  writeFileSync(
    join(s.paths.workspace, 'pair-with-target', 'solution.py'),
    'def f():\n    return 1\n',
  );
  mkdirSync(join(s.paths.explanations, 'pair-with-target'), { recursive: true });
  writeFileSync(
    join(s.paths.explanations, 'pair-with-target', '20261119T143000000Z.html'),
    '<p>x</p>',
  );
}

function snapshot(s: AppStorage) {
  return s.storage.read((db) => ({
    profile: db.getProfile(),
    attempts: db.listAttempts(),
    hints: db.listAttempts().flatMap((a) => db.listHints(a.id)),
    runs: db.listAttempts().flatMap((a) => db.listTestRuns(a.id)),
    topics: db.listTopicProgress(),
    messages: db.listMessages('home'),
  }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'algotutor-data-'));
});
afterEach(async () => {
  for (const s of [...opened]) await close(s);
  rmSync(root, { recursive: true, force: true });
});

describe('export and import', () => {
  it('round-trips progress, chats, settings and workspace files', async () => {
    const a = open(join(root, 'a'));
    await seed(a);
    const before = snapshot(a);
    const zip = join(root, 'export.zip');
    await service(a).exportTo(zip);

    const entries = Object.keys(unzipSync(readFileSync(zip))).sort();
    expect(entries).toEqual([
      'explanations/pair-with-target/20261119T143000000Z.html',
      'manifest.json',
      'settings.json',
      'tutor.db',
      'workspace/pair-with-target/solution.py',
    ]);

    // Import into another data folder that already has (different) data.
    const b = open(join(root, 'b'));
    writeFileSync(join(b.paths.root, 'stale.txt'), 'kept: not ours');
    mkdirSync(join(b.paths.workspace, 'other'), { recursive: true });
    writeFileSync(join(b.paths.workspace, 'other', 'solution.py'), 'old');
    const ui = fakeUi({ chooseImportFile: () => Promise.resolve(zip) });
    const r = await service(b, ui).importInteractive();
    expect(r.staged).toBe(true);
    expect(r.backup).toMatch(/backups[\\/]algo-2026-11-19-1430-before-import\.zip$/);
    expect(existsSync(r.backup!)).toBe(true);
    expect(ui.restarts).toBe(1);
    // Nothing is replaced until the next start.
    expect(snapshot(b).attempts).toEqual([]);

    await close(b);
    expect(applyPending(b.paths)?.op).toBe('import');
    const b2 = open(join(root, 'b'));
    expect(snapshot(b2)).toEqual(before);
    expect(b2.settings.get().ui.theme).toBe('dark');
    expect(b2.settings.get().tutor.effort).toBe('high');
    expect(readFileSync(join(b2.paths.workspace, 'pair-with-target', 'solution.py'), 'utf8')).toBe(
      'def f():\n    return 1\n',
    );
    expect(existsSync(join(b2.paths.workspace, 'other'))).toBe(false);
    expect(
      existsSync(join(b2.paths.explanations, 'pair-with-target', '20261119T143000000Z.html')),
    ).toBe(true);
    expect(existsSync(join(b2.paths.root, 'stale.txt'))).toBe(true);
    expect(existsSync(b2.paths.pending)).toBe(false);
    // Exact 64-bit integers survive (D-11).
    expect(snapshot(b2).runs[0]?.report).toEqual({ big: 9223372036854775807n, total: 3 });
  });

  it('never exports secrets.bin, backups or pending', async () => {
    const a = open(join(root, 'a'));
    writeFileSync(a.paths.secrets, 'encrypted');
    mkdirSync(a.paths.backups, { recursive: true });
    writeFileSync(join(a.paths.backups, 'old.zip'), 'x');
    const zip = join(root, 'e.zip');
    await service(a).exportTo(zip);
    const names = Object.keys(unzipSync(readFileSync(zip)));
    expect(names.some((n) => /secrets|backups|pending/.test(n))).toBe(false);
  });

  it('keeps the stored key across an import', async () => {
    const a = open(join(root, 'a'));
    const zip = join(root, 'e.zip');
    await service(a).exportTo(zip);
    writeFileSync(a.paths.secrets, 'encrypted');
    await service(a).stageImportFrom(zip);
    await close(a);
    applyPending(a.paths);
    expect(readFileSync(a.paths.secrets, 'utf8')).toBe('encrypted');
  });

  it('does nothing when the user cancels the file chooser or the confirmation', async () => {
    const a = open(join(root, 'a'));
    const zip = join(root, 'e.zip');
    await service(a).exportTo(zip);
    expect(await service(a).importInteractive()).toEqual({ staged: false, backup: null });
    const no = fakeUi({
      chooseImportFile: () => Promise.resolve(zip),
      confirm: () => Promise.resolve(false),
    });
    expect(await service(a, no).importInteractive()).toEqual({ staged: false, backup: null });
    expect(no.restarts).toBe(0);
    expect(existsSync(a.paths.pending)).toBe(false);
    expect(existsSync(a.paths.backups)).toBe(false);
  });
});

function without<T>(o: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
}

describe('readArchive refuses', () => {
  async function goodZip(): Promise<Record<string, Uint8Array>> {
    const a = open(join(root, 'src'));
    const zip = join(root, 'good.zip');
    await service(a).exportTo(zip);
    return unzipSync(readFileSync(zip));
  }
  const refuse = (entries: Record<string, Uint8Array>, msg: RegExp) =>
    expect(() => readArchive(zipSync(entries))).toThrow(msg);

  it('a file that is not a zip', () => {
    expect(() => readArchive(strToU8('hello'))).toThrow(ArchiveError);
  });
  it('a zip without a manifest, or of another format', async () => {
    const e = await goodZip();
    refuse(without(e, 'manifest.json'), /no manifest/);
    refuse({ ...e, 'manifest.json': strToU8('{"format":"other"}') }, /not an export of this app/);
  });
  it('accepts an export made before the app was renamed Algo', async () => {
    const e = await goodZip();
    const manifest = JSON.parse(new TextDecoder().decode(e['manifest.json'])) as object;
    const legacy = { ...manifest, format: 'algorithm-tutor-export' };
    expect(() =>
      readArchive(zipSync({ ...e, 'manifest.json': strToU8(JSON.stringify(legacy)) })),
    ).not.toThrow();
  });
  it('names outside the layout, absolute or with ..', async () => {
    const e = await goodZip();
    refuse({ ...e, 'workspace/../../evil.py': strToU8('x') }, /not a plain path/);
    refuse({ ...e, 'secrets.bin': strToU8('x') }, /not part of an export/);
    refuse({ ...e, 'workspace\\x\\y.py': strToU8('x') }, /not a relative path/);
    expect(checkEntryName('/etc/passwd')).toBe('not a relative path');
    expect(checkEntryName('C:/x')).toBe('not a relative path');
    expect(checkEntryName('workspace/a/solution.py')).toBeNull();
    expect(checkEntryName('workspace/')).toBe('not a plain path');
  });
  it('a database that is not ours, or newer than this app', async () => {
    const e = await goodZip();
    refuse({ ...e, 'tutor.db': strToU8('not sqlite') }, /tutor\.db in the file/);
    const newer = join(root, 'newer.db');
    writeFileSync(newer, e['tutor.db']!);
    const db = new DatabaseSync(newer);
    db.exec("UPDATE meta SET value = '99' WHERE key = 'schema_version'");
    db.close();
    refuse({ ...e, 'tutor.db': readFileSync(newer) }, /newer version of the app/);
    refuse(without(e, 'tutor.db'), /no tutor\.db/);
  });
  it('a settings.json that is not JSON', async () => {
    const e = await goodZip();
    refuse({ ...e, 'settings.json': strToU8('{nope') }, /settings\.json/);
  });
});

describe('reset', () => {
  it('reset progress removes attempts and levels, keeps the rest, after a backup', async () => {
    const a = open(join(root, 'a'));
    await seed(a);
    const before = snapshot(a);
    const r = await service(a).resetInteractive('progress');
    expect(r).toMatchObject({ done: true, restarting: false });
    expect(existsSync(r.backup!)).toBe(true);
    const after = snapshot(a);
    expect(after.attempts).toEqual([]);
    expect(after.hints).toEqual([]);
    expect(after.runs).toEqual([]);
    expect(after.topics).toEqual([]);
    expect(after.profile).toEqual(before.profile);
    expect(after.messages).toEqual(before.messages);
    expect(existsSync(join(a.paths.workspace, 'pair-with-target', 'solution.py'))).toBe(true);
  });

  it('reset everything removes our data and the key at the next start, keeps backups', async () => {
    const a = open(join(root, 'a'));
    await seed(a);
    writeFileSync(a.paths.secrets, 'encrypted');
    const ui = fakeUi();
    const r = await service(a, ui).resetInteractive('everything');
    expect(r).toMatchObject({ done: true, restarting: true });
    expect(ui.restarts).toBe(1);
    await close(a);
    expect(applyPending(a.paths)?.op).toBe('reset');
    for (const p of [
      a.paths.db,
      a.paths.settings,
      a.paths.secrets,
      a.paths.workspace,
      a.paths.explanations,
    ])
      expect(existsSync(p)).toBe(false);
    expect(existsSync(r.backup!)).toBe(true);
    const fresh = open(join(root, 'a'));
    expect(snapshot(fresh).profile).toBeNull();
  });

  it('a cancelled confirmation changes nothing', async () => {
    const a = open(join(root, 'a'));
    await seed(a);
    const r = await service(a, fakeUi({ confirm: () => Promise.resolve(false) })).resetInteractive(
      'progress',
    );
    expect(r).toEqual({ done: false, backup: null, restarting: false });
    expect(snapshot(a).attempts).toHaveLength(1);
  });

  it('an incomplete stage is discarded', () => {
    const a = open(join(root, 'a'));
    stageImport(
      a.paths,
      { manifest: {} as never, files: new Map() },
      { op: 'import', source: 'x', at: NOW },
    );
    rmSync(join(a.paths.pending, 'op.json'));
    expect(applyPending(a.paths)).toBeNull();
    expect(existsSync(a.paths.pending)).toBe(false);
  });

  it('a staged import without tutor.db is refused and changes nothing', async () => {
    const a = open(join(root, 'a'));
    await seed(a);
    stageImport(
      a.paths,
      { manifest: {} as never, files: new Map() },
      { op: 'import', source: 'x', at: NOW },
    );
    await close(a);
    expect(() => applyPending(a.paths)).toThrow(/no tutor\.db/);
    expect(existsSync(a.paths.db)).toBe(true);
  });
});
