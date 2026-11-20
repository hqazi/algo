// @vitest-environment jsdom
/** The shared chat composer (T30): Enter sends, the send and stop buttons. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

afterEach(cleanup);

function Box(props: {
  busy?: boolean;
  canSend?: boolean;
  onSend?: () => void;
  onStop?: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <Composer
      value={text}
      onChange={setText}
      onSend={props.onSend ?? (() => undefined)}
      busy={props.busy}
      onStop={props.onStop}
      canSend={props.canSend ?? true}
    />
  );
}

describe('Composer', () => {
  it('sends on Enter, not on Shift+Enter, and only with text', () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message the tutor' });
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(box.className).toContain('ui-autogrow');
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'hello' } });
    expect(send.disabled).toBe(false);
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledOnce();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('shows Stop while a reply streams', () => {
    const onStop = vi.fn();
    render(<Box busy onStop={onStop} canSend={false} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
