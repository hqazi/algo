import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';

describe('App', () => {
  it('shows the app name', () => {
    expect(renderToStaticMarkup(<App />)).toContain('Algorithm Tutor');
  });
});
