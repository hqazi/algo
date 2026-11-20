import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataPaths, resolveDataDir } from './paths';

describe('resolveDataDir', () => {
  const userData = resolve('/users/me/AppData/Algo');

  it('is userData by default', () => {
    expect(resolveDataDir({ userData })).toBe(userData);
    expect(resolveDataDir({ userData, env: {} })).toBe(userData);
    expect(resolveDataDir({ userData, env: { ALGOTUTOR_DATA_DIR: '  ' } })).toBe(userData);
  });

  it('ALGOTUTOR_DATA_DIR overrides it; relative paths resolve against cwd', () => {
    const abs = resolve('/tmp/tutor-dev');
    expect(resolveDataDir({ userData, env: { ALGOTUTOR_DATA_DIR: abs } })).toBe(abs);
    expect(
      resolveDataDir({ userData, env: { ALGOTUTOR_DATA_DIR: 'dev-data' }, cwd: resolve('/work') }),
    ).toBe(resolve('/work', 'dev-data'));
  });
});

describe('dataPaths', () => {
  it('lays out the data folder as SPEC §4.1 says', () => {
    const root = resolve('/data');
    const p = dataPaths(root);
    expect(p.db).toBe(join(root, 'tutor.db'));
    expect(p.settings).toBe(join(root, 'settings.json'));
    expect(p.workspace).toBe(join(root, 'workspace'));
    expect(p.generatedProblems).toBe(join(root, 'problems', 'generated'));
    expect(p.importedProblems).toBe(join(root, 'problems', 'imported'));
    expect(p.explanations).toBe(join(root, 'explanations'));
  });
});
