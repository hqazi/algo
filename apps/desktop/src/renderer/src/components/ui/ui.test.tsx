// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoGrowTextarea, Badge, Button, IconButton, Menu, Segmented, Select } from '.';

afterEach(cleanup);

describe('Button', () => {
  it('maps variant and size to classes and defaults to type="button"', () => {
    render(
      <>
        <Button>Plain</Button>
        <Button variant="primary" size="lg" className="extra">
          Go
        </Button>
        <Button variant="danger" size="sm">
          Delete
        </Button>
      </>,
    );
    const plain = screen.getByRole('button', { name: 'Plain' });
    expect(plain.className).toBe('btn btn-secondary');
    expect(plain.getAttribute('type')).toBe('button');
    expect(screen.getByRole('button', { name: 'Go' }).className).toBe(
      'btn btn-primary btn-lg extra',
    );
    expect(screen.getByRole('button', { name: 'Delete' }).className).toBe('btn btn-danger btn-sm');
  });
});

describe('IconButton', () => {
  it('has its aria-label as name and tooltip', () => {
    const onClick = vi.fn();
    render(<IconButton aria-label="New chat" icon={<svg />} onClick={onClick} />);
    const b = screen.getByRole('button', { name: 'New chat' });
    expect(b.getAttribute('title')).toBe('New chat');
    expect(b.className).toContain('btn-icon');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps an explicit title', () => {
    render(<IconButton aria-label="Run" title="Run (Ctrl+Enter)" icon={<svg />} />);
    expect(screen.getByRole('button', { name: 'Run' }).getAttribute('title')).toBe(
      'Run (Ctrl+Enter)',
    );
  });
});

describe('Select', () => {
  it('is a native select with its label and a decorative chevron', () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Language" value="go" onChange={(e) => onChange(e.target.value)}>
        <option value="python">Python</option>
        <option value="go">Go</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Language' });
    fireEvent.change(select, { target: { value: 'python' } });
    expect(onChange).toHaveBeenCalledWith('python');
    expect(select.parentElement?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Badge', () => {
  it('renders a tinted pill', () => {
    render(
      <Badge tone="easy" dot>
        Easy
      </Badge>,
    );
    expect(screen.getByText('Easy').className).toBe('ui-badge ui-badge-easy ui-badge-dot');
  });
});

function Seg({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState<'problem' | 'general' | 'off'>('problem');
  return (
    <Segmented
      aria-label="Chat"
      value={v}
      onChange={(x) => {
        setV(x);
        onChange?.(x);
      }}
      options={[
        { value: 'problem', label: 'This problem' },
        { value: 'off', label: 'Off', disabled: true },
        { value: 'general', label: 'General' },
      ]}
    />
  );
}

describe('Segmented', () => {
  it('marks the selected option and selects on click', () => {
    const onChange = vi.fn();
    render(<Seg onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Chat' })).toBeTruthy();
    const problem = screen.getByRole('button', { name: 'This problem' });
    const general = screen.getByRole('button', { name: 'General' });
    expect(problem.getAttribute('aria-pressed')).toBe('true');
    expect(general.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(general);
    expect(onChange).toHaveBeenCalledWith('general');
    expect(general.getAttribute('aria-pressed')).toBe('true');
    expect(problem.getAttribute('aria-pressed')).toBe('false');
    // Clicking the selected option again does not fire.
    fireEvent.click(general);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('can be a tablist of tabs that name their panels', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        tabs
        aria-label="Mode"
        value="a"
        onChange={onChange}
        controls={{ a: 'panel-a' }}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Mode' })).toBeTruthy();
    const a = screen.getByRole('tab', { name: 'Alpha' });
    const b = screen.getByRole('tab', { name: 'Beta' });
    expect(a.getAttribute('aria-selected')).toBe('true');
    expect(a.getAttribute('aria-controls')).toBe('panel-a');
    expect(b.getAttribute('aria-selected')).toBe('false');
    expect(a.hasAttribute('aria-pressed')).toBe(false);
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('moves the selection with arrow keys, skipping disabled options, and keeps one tab stop', () => {
    render(<Seg />);
    const problem = screen.getByRole('button', { name: 'This problem' });
    const general = screen.getByRole('button', { name: 'General' });
    expect(problem.tabIndex).toBe(0);
    expect(general.tabIndex).toBe(-1);
    problem.focus();
    fireEvent.keyDown(problem, { key: 'ArrowRight' });
    expect(general.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(general);
    expect(general.tabIndex).toBe(0);
    expect(problem.tabIndex).toBe(-1);
    // Wraps around.
    fireEvent.keyDown(general, { key: 'ArrowRight' });
    expect(problem.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(problem, { key: 'End' });
    expect(general.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(general, { key: 'Home' });
    expect(problem.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(problem, { key: 'ArrowLeft' });
    expect(general.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Menu', () => {
  function setup() {
    const giveUp = vi.fn();
    const reset = vi.fn();
    const archive = vi.fn();
    render(
      <>
        <Menu
          label="More actions"
          items={[
            { label: 'Give up', onSelect: giveUp, danger: true },
            { label: 'Archive', onSelect: archive, disabled: true },
            { label: 'Reset', onSelect: reset },
          ]}
        />
        <button type="button">Outside</button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'More actions' });
    return { trigger, giveUp, reset, archive };
  }

  it('opens on click with focus on the first item; Escape closes and returns focus', () => {
    const { trigger } = setup();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Give up' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('moves focus with arrows, Home, End and letters, skipping disabled items', () => {
    const { trigger } = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const giveUp = screen.getByRole('menuitem', { name: 'Give up' });
    const reset = screen.getByRole('menuitem', { name: 'Reset' });
    expect(document.activeElement).toBe(giveUp);
    fireEvent.keyDown(giveUp, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(reset);
    fireEvent.keyDown(reset, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(giveUp);
    fireEvent.keyDown(giveUp, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(reset);
    fireEvent.keyDown(reset, { key: 'Home' });
    expect(document.activeElement).toBe(giveUp);
    fireEvent.keyDown(giveUp, { key: 'End' });
    expect(document.activeElement).toBe(reset);
    fireEvent.keyDown(reset, { key: 'g' });
    expect(document.activeElement).toBe(giveUp);
  });

  it('opens on the last item with ArrowUp', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Reset' }));
  });

  it('runs the chosen item, closes and returns focus', () => {
    const { trigger, reset, giveUp } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(giveUp).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside and on Tab', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Give up' }), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps a visible trigger label as its name', () => {
    render(
      <Menu label="Sort" trigger="Sort by" items={[{ label: 'Title', onSelect: () => {} }]} />,
    );
    expect(screen.getByRole('button', { name: 'Sort by' })).toBeTruthy();
  });
});

describe('AutoGrowTextarea', () => {
  // jsdom has no layout: give every textarea a scrollHeight of 20px per line.
  function withLayout(): () => void {
    const proto = HTMLTextAreaElement.prototype;
    Object.defineProperty(proto, 'scrollHeight', {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return this.value.split('\n').length * 20;
      },
    });
    return () => {
      delete (proto as unknown as Record<string, unknown>)['scrollHeight'];
    };
  }

  it('grows with its content up to maxHeight, then scrolls', () => {
    const restore = withLayout();
    try {
      function Box() {
        const [v, setV] = useState('one');
        return (
          <AutoGrowTextarea
            aria-label="Message"
            maxHeight={100}
            value={v}
            onChange={(e) => setV(e.target.value)}
          />
        );
      }
      render(<Box />);
      const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
      expect(box.style.height).toBe('20px');
      expect(box.style.overflowY).toBe('hidden');
      expect(box.className).toContain('ui-autogrow');
      fireEvent.change(box, { target: { value: 'one\ntwo\nthree' } });
      expect(box.style.height).toBe('60px');
      fireEvent.change(box, { target: { value: 'a\nb\nc\nd\ne\nf\ng' } });
      expect(box.style.height).toBe('100px');
      expect(box.style.overflowY).toBe('auto');
      fireEvent.change(box, { target: { value: '' } });
      expect(box.style.height).toBe('20px');
      expect(box.style.overflowY).toBe('hidden');
    } finally {
      restore();
    }
  });

  it('grows while uncontrolled and forwards its ref and onInput', () => {
    const restore = withLayout();
    try {
      const onInput = vi.fn();
      let node: HTMLTextAreaElement | null = null;
      render(
        <AutoGrowTextarea
          aria-label="Notes"
          onInput={onInput}
          ref={(t) => {
            node = t;
          }}
        />,
      );
      const box = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement;
      expect(node).toBe(box);
      box.value = 'a\nb';
      fireEvent.input(box);
      expect(box.style.height).toBe('40px');
      expect(onInput).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });
});
