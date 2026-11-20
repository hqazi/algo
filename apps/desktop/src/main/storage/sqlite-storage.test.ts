import type { ProblemRecord, ProfileRecord } from '@algorithm-tutor/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { SqliteStorage, StorageClosedError } from './sqlite-storage';

const T = (n: number): string => `2026-11-18T10:00:${String(n).padStart(2, '0')}Z`;

const profile: ProfileRecord = {
  goal: 'interview',
  interviewDate: '2027-01-15',
  experience: 'some',
  comfort: { linear: 'some', graphs: 'none' },
  hintPreference: 'early',
  focusTopic: null,
  language: 'python',
  onboarded: true,
  createdAt: T(0),
  updatedAt: T(1),
};

const problem: ProblemRecord = {
  slug: 'two-sum',
  source: 'curated',
  topic: 'arrays-hashing',
  difficulty: 'easy',
  title: 'Two Sum',
  path: 'problems/arrays-hashing/two-sum',
  contentVersion: 1,
  createdAt: T(0),
};

let s: SqliteStorage;
beforeEach(() => {
  s = new SqliteStorage(openDatabase(':memory:').db);
});
afterEach(async () => {
  await s.close();
});

describe('records round-trip', () => {
  it('meta', async () => {
    expect(s.read((db) => db.getMeta('schema_version'))).toBe('2');
    expect(s.read((db) => db.getMeta('install_id'))).toMatch(/^[0-9a-f-]{36}$/);
    await s.write((db) => db.setMeta('k', 'v1'));
    await s.write((db) => db.setMeta('k', 'v2'));
    expect(s.read((db) => db.getMeta('k'))).toBe('v2');
    expect(s.read((db) => db.getMeta('missing'))).toBeNull();
  });

  it('profile: one row, replaced on save', async () => {
    expect(s.read((db) => db.getProfile())).toBeNull();
    await s.write((db) => db.saveProfile(profile));
    expect(s.read((db) => db.getProfile())).toEqual(profile);
    const changed = { ...profile, focusTopic: 'graphs', onboarded: false, updatedAt: T(5) };
    await s.write((db) => db.saveProfile(changed));
    expect(s.read((db) => db.getProfile())).toEqual(changed);
  });

  it('topic progress', async () => {
    await s.write((db) => {
      db.saveTopicProgress({
        topic: 'graphs',
        level: 'learning',
        unaidedSolves: 1,
        updatedAt: T(1),
      });
      db.saveTopicProgress({ topic: 'arrays', level: 'new', unaidedSolves: 0, updatedAt: T(1) });
      db.saveTopicProgress({
        topic: 'graphs',
        level: 'comfortable',
        unaidedSolves: 3,
        updatedAt: T(2),
      });
    });
    expect(s.read((db) => db.listTopicProgress()).map((t) => [t.topic, t.level])).toEqual([
      ['arrays', 'new'],
      ['graphs', 'comfortable'],
    ]);
    expect(s.read((db) => db.getTopicProgress('graphs'))?.unaidedSolves).toBe(3);
    expect(s.read((db) => db.getTopicProgress('trees'))).toBeNull();
  });

  it('problems: upsert, filter, delete', async () => {
    const gen: ProblemRecord = {
      ...problem,
      slug: 'my-graph',
      source: 'generated',
      topic: 'graphs',
      path: 'problems/generated/my-graph',
    };
    await s.write((db) => {
      db.saveProblem(problem);
      db.saveProblem(gen);
      db.saveProblem({ ...problem, title: 'Two Sum (v2)', contentVersion: 2 });
    });
    expect(s.read((db) => db.getProblem('two-sum'))).toEqual({
      ...problem,
      title: 'Two Sum (v2)',
      contentVersion: 2,
    });
    expect(s.read((db) => db.listProblems()).map((p) => p.slug)).toEqual(['two-sum', 'my-graph']);
    expect(s.read((db) => db.listProblems({ source: 'generated' })).map((p) => p.slug)).toEqual([
      'my-graph',
    ]);
    expect(s.read((db) => db.listProblems({ topic: 'arrays-hashing' })).length).toBe(1);
    await s.write((db) => db.deleteProblem('my-graph'));
    expect(s.read((db) => db.getProblem('my-graph'))).toBeNull();
  });

  it('attempts: create, update, open, list', async () => {
    const a = await s.write((db) =>
      db.createAttempt({ slug: 'two-sum', language: 'python', startedAt: T(1) }),
    );
    expect(a).toEqual({
      id: a.id,
      slug: 'two-sum',
      language: 'python',
      startedAt: T(1),
      finishedAt: null,
      passed: null,
      total: null,
      outcome: null,
      hintsUsed: 0,
      explained: false,
      notes: '',
    });
    expect(s.read((db) => db.getOpenAttempt('two-sum'))?.id).toBe(a.id);

    const done = await s.write((db) =>
      db.updateAttempt(a.id, {
        finishedAt: T(2),
        passed: 5,
        total: 5,
        outcome: 'with_hints',
        hintsUsed: 2,
        explained: true,
        notes: 'used a map',
      }),
    );
    expect(done).toMatchObject({
      outcome: 'with_hints',
      explained: true,
      passed: 5,
      notes: 'used a map',
    });
    expect(s.read((db) => db.getOpenAttempt('two-sum'))).toBeNull();

    await s.write((db) => {
      for (let i = 3; i <= 6; i++)
        db.createAttempt({ slug: i % 2 ? 'a' : 'b', language: 'python', startedAt: T(i) });
    });
    expect(s.read((db) => db.listAttempts()).map((x) => x.startedAt)).toEqual([
      T(1),
      T(3),
      T(4),
      T(5),
      T(6),
    ]);
    expect(s.read((db) => db.listAttempts({ last: 2 })).map((x) => x.startedAt)).toEqual([
      T(5),
      T(6),
    ]);
    expect(s.read((db) => db.listAttempts({ slug: 'a' })).map((x) => x.startedAt)).toEqual([
      T(3),
      T(5),
    ]);
    expect(s.read((db) => db.listAttempts({ open: false })).map((x) => x.id)).toEqual([a.id]);
    expect(s.read((db) => db.listAttempts({ open: true })).length).toBe(4);
    expect(s.read((db) => db.getOpenAttempt('a'))?.startedAt).toBe(T(5));

    await expect(s.write((db) => db.updateAttempt(999, { notes: 'x' }))).rejects.toThrow(
      /no attempt with id 999/,
    );
  });

  it('the schema refuses values outside the allowed sets', async () => {
    const a = await s.write((db) =>
      db.createAttempt({ slug: 'x', language: 'python', startedAt: T(1) }),
    );
    await expect(
      s.write((db) => db.updateAttempt(a.id, { outcome: 'won' as never })),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      s.write((db) => db.saveProblem({ ...problem, difficulty: 'trivial' as never })),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('hints and test runs belong to an attempt; reports keep exact 64-bit integers', async () => {
    const a = await s.write((db) =>
      db.createAttempt({ slug: 'x', language: 'python', startedAt: T(1) }),
    );
    const report = { passed: 1, total: 2, cases: [{ id: 'big', actual: 4660046610375530309n }] };
    const run = await s.write((db) => {
      db.addHint({ attemptId: a.id, level: 1, givenAt: T(2) });
      db.addHint({ attemptId: a.id, level: 2, givenAt: T(3) });
      return db.addTestRun({ attemptId: a.id, kind: 'submit', report, createdAt: T(4) });
    });
    expect(s.read((db) => db.listHints(a.id)).map((h) => h.level)).toEqual([1, 2]);
    expect(s.read((db) => db.listTestRuns(a.id))).toEqual([
      { id: run.id, attemptId: a.id, kind: 'submit', report, createdAt: T(4) },
    ]);
    await expect(
      s.write((db) => db.addHint({ attemptId: 12345, level: 1, givenAt: T(5) })),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it('threads and messages', async () => {
    await s.write((db) => {
      db.saveThread({
        id: 'home',
        backend: 'anthropic',
        backendState: {},
        createdAt: T(1),
        archivedAt: null,
      });
      db.saveThread({
        id: 'two-sum',
        backend: 'fake',
        backendState: null,
        createdAt: T(2),
        archivedAt: null,
      });
    });
    const m1 = await s.write((db) =>
      db.appendMessage({
        threadId: 'home',
        role: 'user',
        content: { text: 'hi' },
        createdAt: T(3),
      }),
    );
    const m2 = await s.write((db) =>
      db.appendMessage({
        threadId: 'home',
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool', name: 'next_problem' },
        ],
        createdAt: T(4),
      }),
    );
    expect([m1.seq, m2.seq]).toEqual([1, 2]);
    expect(s.read((db) => db.listMessages('home'))).toEqual([m1, m2]);
    expect(s.read((db) => db.listMessages('home', { afterSeq: 1 }))).toEqual([m2]);

    // Re-saving a thread (new backend state, archived) keeps its messages.
    await s.write((db) =>
      db.saveThread({
        id: 'home',
        backend: 'anthropic',
        backendState: { session: 's1' },
        createdAt: T(1),
        archivedAt: T(9),
      }),
    );
    expect(s.read((db) => db.getThread('home'))?.backendState).toEqual({ session: 's1' });
    expect(s.read((db) => db.listMessages('home')).length).toBe(2);
    expect(s.read((db) => db.listThreads({ archived: true })).map((t) => t.id)).toEqual(['home']);
    expect(s.read((db) => db.listThreads({ archived: false })).map((t) => t.id)).toEqual([
      'two-sum',
    ]);
    expect(s.read((db) => db.listThreads()).length).toBe(2);

    await s.write((db) => db.deleteThread('home'));
    expect(s.read((db) => db.getThread('home'))).toBeNull();
    expect(s.read((db) => db.listMessages('home'))).toEqual([]);
    await expect(
      s.write((db) =>
        db.appendMessage({ threadId: 'nope', role: 'user', content: 'x', createdAt: T(1) }),
      ),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe('writes', () => {
  it('archives a thread under a new id with its messages', async () => {
    await s.write((db) => {
      db.saveThread({
        id: 'home',
        backend: 'fake',
        backendState: { n: 1 },
        createdAt: T(1),
        archivedAt: null,
      });
      db.appendMessage({ threadId: 'home', role: 'user', content: { text: 'a' }, createdAt: T(2) });
      db.appendMessage({
        threadId: 'home',
        role: 'assistant',
        content: { text: 'b' },
        createdAt: T(3),
      });
    });
    await s.write((db) => db.archiveThread('home', 'home~1', T(4)));
    expect(s.read((db) => db.getThread('home'))).toBeNull();
    expect(s.read((db) => db.getThread('home~1'))).toEqual({
      id: 'home~1',
      backend: 'fake',
      backendState: { n: 1 },
      createdAt: T(1),
      archivedAt: T(4),
    });
    expect(s.read((db) => db.listMessages('home~1')).map((m) => m.seq)).toEqual([1, 2]);
    expect(s.read((db) => db.listMessages('home'))).toEqual([]);
    // The id is free again, and numbering starts afresh.
    await s.write((db) => {
      db.saveThread({
        id: 'home',
        backend: 'fake',
        backendState: {},
        createdAt: T(5),
        archivedAt: null,
      });
      return db.appendMessage({
        threadId: 'home',
        role: 'user',
        content: { text: 'c' },
        createdAt: T(6),
      });
    });
    expect(s.read((db) => db.listMessages('home')).map((m) => m.seq)).toEqual([1]);
    await expect(s.write((db) => db.archiveThread('nope', 'nope~1', T(7)))).rejects.toThrow(
      /no thread/,
    );
    await expect(s.write((db) => db.archiveThread('home', 'home~1', T(7)))).rejects.toThrow();
    expect(s.read((db) => db.listMessages('home')).length).toBe(1);
  });

  it('a write that throws keeps nothing it wrote', async () => {
    await expect(
      s.write((db) => {
        db.saveProblem(problem);
        db.setMeta('k', 'v');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(s.read((db) => db.getProblem('two-sum'))).toBeNull();
    expect(s.read((db) => db.getMeta('k'))).toBeNull();
    // The queue carries on after a failure.
    await s.write((db) => db.setMeta('k', 'after'));
    expect(s.read((db) => db.getMeta('k'))).toBe('after');
  });

  it('refuses an asynchronous write function and keeps nothing', async () => {
    await expect(
      s.write(async (db) => {
        db.setMeta('k', 'v');
      }),
    ).rejects.toThrow(/must be synchronous/);
    expect(s.read((db) => db.getMeta('k'))).toBeNull();
  });

  it('run one at a time, in order, with a serial task holding the queue while it awaits', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const serial = s.serial(async (write) => {
      order.push('serial: start');
      write((db) => db.setMeta('n', '1'));
      await gate; // e.g. running the tests
      order.push('serial: after await');
      return write((db) => {
        db.setMeta('n', String(Number(db.getMeta('n')) + 1));
        return db.getMeta('n');
      });
    });
    const later = s.write((db) => {
      order.push('write');
      db.setMeta('n', String(Number(db.getMeta('n')) * 10));
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['serial: start']);
    // Reads are not queued: they see what the serial task has committed so far.
    expect(s.read((db) => db.getMeta('n'))).toBe('1');
    release();
    expect(await serial).toBe('2');
    await later;
    expect(order).toEqual(['serial: start', 'serial: after await', 'write']);
    expect(s.read((db) => db.getMeta('n'))).toBe('20');
  });

  it('refuses write() and serial() from inside a serial task instead of deadlocking', async () => {
    await expect(
      s.serial(async () => {
        await s.write((db) => db.setMeta('k', 'v'));
      }),
    ).rejects.toThrow(/would wait on itself/);
    await expect(s.serial(async () => s.serial(async () => 1))).rejects.toThrow(
      /would wait on itself/,
    );
  });

  it('close waits for queued writes, then refuses more', async () => {
    const pending = s.write((db) => db.setMeta('k', 'v'));
    await s.close();
    await expect(pending).resolves.toBeUndefined();
    expect(() => s.read((db) => db.getMeta('k'))).toThrow(StorageClosedError);
    expect(() => s.write((db) => db.getMeta('k'))).toThrow(StorageClosedError);
  });
});
