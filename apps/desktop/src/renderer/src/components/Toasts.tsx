/**
 * The toast stack (`notify` in lib/app): bottom-right, a surface with a
 * shadow and an icon per kind (docs/design.md → Toasts). Errors are alerts;
 * the rest are polite status messages.
 */
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import type { Toast } from '../lib/app-context';
import { useApp } from '../lib/app-context';
import { IconButton } from './ui';

const ICONS: Record<Toast['kind'], typeof Info> = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
};

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={`toast toast-${t.kind}`}
            role={t.kind === 'error' ? 'alert' : 'status'}
          >
            <Icon className="toast-icon" aria-hidden="true" />
            <span className="toast-text">{t.text}</span>
            <IconButton
              size="sm"
              aria-label="Dismiss"
              icon={<X aria-hidden="true" />}
              onClick={() => dismiss(t.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
