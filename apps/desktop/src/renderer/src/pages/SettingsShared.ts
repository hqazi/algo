/** Helpers shared by the Settings sections and onboarding's tutor step. */
import { useEffect, useState } from 'react';
import type { KeyStatusView } from '../../../shared/settings';
import { invoke } from '../ipc';

export function useKeyStatus(): [KeyStatusView | null, (s: KeyStatusView) => void] {
  const [status, setStatus] = useState<KeyStatusView | null>(null);
  useEffect(() => {
    let live = true;
    void invoke('secrets:status').then(
      (s) => live && setStatus(s),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return [status, setStatus];
}

/** Where the key comes from, in words. */
export function keyText(s: KeyStatusView): string {
  if (s.source === 'environment')
    return `From the environment (ANTHROPIC_API_KEY), ends in ${s.hint ?? '…'}`;
  if (s.source === 'stored') return `Stored, ends in ${s.hint ?? '…'}`;
  return 'No key';
}
