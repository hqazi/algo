import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';

describe('App', () => {
  it('shows the app name', () => {
    expect(renderToStaticMarkup(<App />)).toContain('Algorithm Tutor');
  });

  it('shows the versions from app:version', () => {
    const html = renderToStaticMarkup(
      <App initialVersions={{ app: '0.0.0', electron: '45.3.4', chrome: '156.0', node: '24' }} />,
    );
    expect(html).toContain('Electron 45.3.4');
  });
});
