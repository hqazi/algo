export const APP_NAME = 'Algo';

/** The display name of the app, optionally with a version: "Algo 1.2.3". */
export function appTitle(version?: string): string {
  const v = version?.trim();
  return v ? `${APP_NAME} ${v}` : APP_NAME;
}

export * from './types';
export * from './compare';
export * from './problems';
export * from './exec';
export * from './storage';
export * from './settings';
export * from './teaching';
export * from './tools';
export * from './tutor';
export * from './intake';
export * from './langs';
export * from './library';
