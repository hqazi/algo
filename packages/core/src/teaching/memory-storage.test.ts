import { describe, expect, it } from 'vitest';
import { MemoryStorage } from './memory-storage';

const start = { slug: 'a', language: 'python' as const, startedAt: '2026-11-19T00:00:00Z' };

describe('MemoryStorage', () => {
  it('archives a thread under a new id with its messages', async () => {
    const s = new MemoryStorage();
    const T = (n: number): string => `2026-11-18T10:00:0${n}Z`;
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

  it('rolls a failed write back', async () => {
    const s = new MemoryStorage();
    await s.write((db) => db.createAttempt(start));
    await expect(
      s.write((db) => {
        db.updateAttempt(1, { hintsUsed: 3 });
        db.createAttempt(start);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(s.read((db) => db.listAttempts())).toEqual([
      expect.objectContaining({ id: 1, hintsUsed: 0 }),
    ]);
    // Ids are not reused after a rollback either way: the next one is 2.
    expect((await s.write((db) => db.createAttempt(start))).id).toBe(2);
  });

  it('copies records in and out', async () => {
    const s = new MemoryStorage();
    const a = await s.write((db) => db.createAttempt(start));
    a.hintsUsed = 9;
    expect(s.read((db) => db.getAttempt(1))?.hintsUsed).toBe(0);
  });

  it('runs writes and serial tasks one at a time, in order', async () => {
    const s = new MemoryStorage();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const serial = s.serial(async (write) => {
      order.push('serial start');
      await gate;
      write((db) => db.createAttempt(start));
      order.push('serial end');
    });
    const write = s.write((db) => {
      order.push(`write sees ${db.listAttempts().length}`);
    });
    await Promise.resolve();
    release();
    await Promise.all([serial, write]);
    expect(order).toEqual(['serial start', 'serial end', 'write sees 1']);
  });

  it('refuses re-entry and async write functions', async () => {
    const s = new MemoryStorage();
    await expect(s.serial(() => s.write(() => 1))).rejects.toThrow(/wait on itself/);
    await expect(s.write(() => Promise.resolve(1) as unknown as number)).rejects.toThrow(
      /synchronous/,
    );
  });

  it('lists the newest N attempts oldest first; open attempts by slug', async () => {
    const s = new MemoryStorage();
    await s.write((db) => {
      for (let i = 0; i < 4; i++) db.createAttempt({ ...start, slug: i % 2 ? 'b' : 'a' });
      db.updateAttempt(1, { outcome: 'unaided' });
    });
    expect(s.read((db) => db.listAttempts({ last: 2 })).map((a) => a.id)).toEqual([3, 4]);
    expect(s.read((db) => db.getOpenAttempt('a'))?.id).toBe(3);
    expect(s.read((db) => db.listAttempts({ open: false })).map((a) => a.id)).toEqual([1]);
  });
});
