import { isAbsolute, join, resolve } from 'node:path';

/** Overrides the data folder, for tests and development (SPEC §4.1, §12). */
export const DATA_DIR_ENV = 'ALGOTUTOR_DATA_DIR';

/**
 * The folder for everything the user produces: `ALGOTUTOR_DATA_DIR` if set
 * (relative paths resolve against `cwd`), else Electron's `userData`.
 */
export function resolveDataDir(opts: {
  userData: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}): string {
  const override = opts.env?.[DATA_DIR_ENV]?.trim();
  if (override) return isAbsolute(override) ? override : resolve(opts.cwd ?? '.', override);
  return opts.userData;
}

/** Where each kind of data lives inside the data folder (SPEC §4.1). */
export function dataPaths(dataDir: string) {
  return {
    root: dataDir,
    db: join(dataDir, 'tutor.db'),
    settings: join(dataDir, 'settings.json'),
    workspace: join(dataDir, 'workspace'),
    generatedProblems: join(dataDir, 'problems', 'generated'),
    importedProblems: join(dataDir, 'problems', 'imported'),
    explanations: join(dataDir, 'explanations'),
    cache: join(dataDir, 'cache'),
    logs: join(dataDir, 'logs'),
  };
}

export type DataPaths = ReturnType<typeof dataPaths>;
