import { describe, expect, it } from 'vitest';
import { APP_NAME, appTitle } from './index';

describe('appTitle', () => {
  it('is the app name without a version', () => {
    expect(appTitle()).toBe(APP_NAME);
    expect(appTitle('  ')).toBe('Algo');
  });

  it('appends a version', () => {
    expect(appTitle('1.2.3')).toBe('Algo 1.2.3');
  });
});
