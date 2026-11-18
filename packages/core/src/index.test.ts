import { describe, expect, it } from 'vitest';
import { APP_NAME, appTitle } from './index';

describe('appTitle', () => {
  it('is the app name without a version', () => {
    expect(appTitle()).toBe(APP_NAME);
    expect(appTitle('  ')).toBe('Algorithm Tutor');
  });

  it('appends a version', () => {
    expect(appTitle('1.2.3')).toBe('Algorithm Tutor 1.2.3');
  });
});
