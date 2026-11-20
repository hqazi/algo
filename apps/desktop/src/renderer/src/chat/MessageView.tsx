/**
 * One chat message: user text as plain text; assistant text as sanitised
 * Markdown (lib/markdown: raw HTML dropped, then DOMPurify) with tool chips
 * in the order they ran, and an error line when the turn failed. Ported from
 * `dsa-tutor/web/src/chat/MessageView.tsx`; restyled in T30 (user messages as
 * accent-subtle bubbles, tutor messages unboxed, faint chips).
 */
import { Check, LoaderCircle, X } from 'lucide-react';
import { Markdown } from '../components/Markdown';
import type { ToolChipView } from '../../../shared/tutor';
import type { Part, ViewMessage } from './store';

const ACTION_LABEL: Record<string, string> = { hint: 'Hint', review: 'Review', explain: 'Explain' };

const ERROR_TITLE: Record<string, string> = {
  auth: 'The AI provider rejected the API key.',
  rate_limit: 'The AI provider is busy right now.',
  network: 'Could not reach the AI provider.',
  refusal: 'The tutor declined to answer that.',
  max_tokens: 'The reply was too long and was cut off.',
  other: 'The tutor ran into a problem.',
  cancelled: 'Stopped.',
};

const ERROR_HELP: Record<string, string> = {
  auth: 'Check the API key and its permissions.',
  rate_limit: 'Wait a moment, then try again.',
  network: 'Check the network connection, then try again.',
};

function Chip({ chip }: { chip: ToolChipView }) {
  const state = chip.ok === null ? 'running' : chip.ok ? 'ok' : 'fail';
  const Icon = chip.ok === null ? LoaderCircle : chip.ok ? Check : X;
  return (
    <li
      className={`chip chip-${state}`}
      title={chip.name}
      data-testid="tool-chip"
      data-state={state}
    >
      <Icon className="chip-icon" size={12} strokeWidth={2.25} aria-hidden="true" />
      <span className="chip-text">{chip.summary}</span>
      {state === 'fail' && <span className="sr-only"> (failed)</span>}
    </li>
  );
}

type Group = { kind: 'text'; text: string } | { kind: 'tools'; chips: ToolChipView[] };

/** Consecutive tool parts render as one row of chips. */
function groups(parts: Part[]): Group[] {
  const out: Group[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p.kind === 'tool') {
      if (last?.kind === 'tools') last.chips.push(p.chip);
      else out.push({ kind: 'tools', chips: [p.chip] });
    } else out.push({ kind: 'text', text: p.text });
  }
  return out;
}

export function MessageView({ message, onRetry }: { message: ViewMessage; onRetry?: () => void }) {
  if (message.role === 'user') {
    return (
      <div className="msg msg-user" data-testid="msg-user">
        {message.action && (
          <span className="msg-action">{ACTION_LABEL[message.action] ?? message.action}</span>
        )}
        <div className="msg-text">{message.text}</div>
      </div>
    );
  }
  const err = message.error;
  const empty = message.parts.length === 0;
  return (
    <div
      className="msg msg-assistant"
      data-testid="msg-assistant"
      aria-busy={message.pending || undefined}
    >
      {groups(message.parts).map((g, i) =>
        g.kind === 'tools' ? (
          <ul key={i} className="chips" aria-label="Tutor activity">
            {g.chips.map((c) => (
              <Chip key={c.id} chip={c} />
            ))}
          </ul>
        ) : (
          <Markdown key={i} source={g.text} />
        ),
      )}
      {message.pending && empty && <p className="muted typing">Thinking…</p>}
      {err &&
        (err.kind === 'cancelled' ? (
          <p className="msg-stopped muted small">Stopped.</p>
        ) : (
          <div className="msg-error" role="alert" data-testid="msg-error" data-kind={err.kind}>
            <strong>{ERROR_TITLE[err.kind] ?? ERROR_TITLE.other}</strong>
            {err.message && <span> {err.message}</span>}
            {ERROR_HELP[err.kind] && <span className="muted"> {ERROR_HELP[err.kind]}</span>}
            {onRetry && (
              <div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                  Try again
                </button>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
