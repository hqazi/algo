import { describe, expect, it } from 'vitest';
import { href, parse } from './router';

describe('router', () => {
  it('parses and builds every route', () => {
    for (const path of ['/', '/welcome', '/problems', '/progress', '/p/pair-with-target'])
      expect(href(parse(path))).toBe(path);
    expect(parse('/p/pair-with-target')).toEqual({ name: 'problem', slug: 'pair-with-target' });
    expect(parse('/p/Bad_Slug')).toEqual({ name: 'not_found', path: '/p/Bad_Slug' });
    expect(parse('/problems/')).toEqual({ name: 'problems' });
  });
});
