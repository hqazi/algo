import { useEffect, useState } from 'react';
import { APP_NAME } from '@algorithm-tutor/core';
import type { InvokeResponse } from '../../shared/ipc';
import { invoke } from './ipc';

type Versions = InvokeResponse<'app:version'>;

export function App({ initialVersions }: { initialVersions?: Versions } = {}) {
  const [versions, setVersions] = useState<Versions | undefined>(initialVersions);

  useEffect(() => {
    if (versions) return;
    invoke('app:version').then(setVersions, (e: unknown) => console.error(e));
  }, [versions]);

  return (
    <main className="app">
      <h1>{APP_NAME}</h1>
      {versions && (
        <p className="versions">
          Version {versions.app} · Electron {versions.electron} · Chromium {versions.chrome}
        </p>
      )}
    </main>
  );
}
