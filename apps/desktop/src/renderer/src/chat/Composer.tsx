/**
 * The chat composer (T30, docs/design.md → Practice): one rounded box with a
 * text area that grows with its content and the send button inside it; while
 * a reply streams the button is **Stop**. Enter sends, Shift+Enter makes a new
 * line (IME composition is left alone). Shared by the tutor pane and the
 * Library's chats (T32).
 */
import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { AutoGrowTextarea, IconButton } from '../components/ui';

export interface ComposerProps {
  value: string;
  onChange: (text: string) => void;
  /** Send the current text (the form's submit and Enter). */
  onSend: () => void;
  /** A reply is streaming: the button stops it. */
  busy?: boolean | undefined;
  onStop?: (() => void) | undefined;
  stopping?: boolean | undefined;
  /** Sending is possible (the tutor is ready and not replying). */
  canSend: boolean;
  /** The text area is off (the tutor is not set up). */
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  /** The text area's accessible name. */
  label?: string | undefined;
  maxLength?: number | undefined;
  textareaRef?: Ref<HTMLTextAreaElement> | undefined;
  /** Extra controls inside the box, before the send button. */
  extra?: ReactNode;
}

export function Composer({
  value,
  onChange,
  onSend,
  busy,
  onStop,
  stopping,
  canSend,
  disabled,
  placeholder,
  label = 'Message the tutor',
  maxLength = 20_000,
  textareaRef,
  extra,
}: ComposerProps) {
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <form
      className={disabled ? 'composer disabled' : 'composer'}
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <AutoGrowTextarea
        ref={textareaRef}
        value={value}
        maxHeight={192}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-bar">
        {extra}
        <span className="spacer" />
        <span className="composer-hint faint" aria-hidden="true">
          Enter to send · Shift+Enter for a new line
        </span>
        {busy && onStop ? (
          <IconButton
            aria-label="Stop"
            title={stopping ? 'Stopping…' : 'Stop the reply'}
            className="composer-send stop"
            size="sm"
            variant="secondary"
            icon={<Square size={12} fill="currentColor" aria-hidden="true" />}
            onClick={onStop}
            disabled={stopping}
          />
        ) : (
          <IconButton
            type="submit"
            aria-label="Send"
            title="Send (Enter)"
            className="composer-send"
            size="sm"
            variant="primary"
            icon={<ArrowUp aria-hidden="true" />}
            disabled={!canSend || !value.trim()}
          />
        )}
      </div>
    </form>
  );
}
