// @vitest-environment jsdom
/** Panes (T29): a shared header per pane, 1px dividers resizable by keyboard; collapsing and pane keys (T35). */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaneHeader } from './PaneHeader';
import { LeaderKeys } from './Leader';
import { Panes, type Pane } from './Panes';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const PANES: [Pane, Pane, Pane] = [
  { id: 'a', title: 'Left', content: <p>left body</p>, actions: <button>Refresh</button> },
  { id: 'b', title: 'Middle', content: <p>middle body</p> },
  {
    id: 'c',
    title: 'Right',
    header: false,
    content: (
      <div>
        <PaneHeader title="Own header">
          <button>New chat</button>
        </PaneHeader>
      </div>
    ),
  },
];

describe('Panes', () => {
  it('gives each pane a header with its title and actions, unless it draws its own', () => {
    render(<Panes panes={PANES} storageKey="t" />);
    const left = screen.getByRole('region', { name: 'Left' });
    expect(left.querySelector('.pane-header h2')?.textContent).toBe('Left');
    expect(left.querySelector('.pane-header button')?.textContent).toBe('Refresh');
    expect(left.querySelector('.pane-body')?.textContent).toBe('left body');
    expect(screen.getByRole('heading', { name: 'Middle' })).toBeTruthy();
    const right = screen.getByRole('region', { name: 'Right' });
    expect(right.querySelectorAll('.pane-header')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Right' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Own header' })).toBeTruthy();
  });

  it('meets at 1px dividers that the arrow keys resize, within limits', () => {
    const { container } = render(
      <Panes panes={PANES} storageKey="t" initialSizes={[30, 40, 30]} />,
    );
    const grid = container.querySelector('.panes') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('30fr 1px 40fr 1px 30fr');
    const [first, second] = screen.getAllByRole('separator', { name: 'Resize' });
    expect(first!.getAttribute('tabindex')).toBe('0');
    expect(first!.getAttribute('aria-valuenow')).toBe('30');
    fireEvent.keyDown(first!, { key: 'ArrowRight' });
    expect(grid.style.gridTemplateColumns).toBe('32fr 1px 38fr 1px 30fr');
    fireEvent.keyDown(second!, { key: 'ArrowLeft' });
    expect(grid.style.gridTemplateColumns).toBe('32fr 1px 36fr 1px 32fr');
    for (let i = 0; i < 30; i++) fireEvent.keyDown(first!, { key: 'ArrowLeft' });
    expect(grid.style.gridTemplateColumns).toBe('15fr 1px 53fr 1px 32fr');
    expect(JSON.parse(localStorage.getItem('t')!)).toEqual([15, 53, 32]);
  });

  it('stacks the panes as tabs when narrow, keeping their state across the switch', () => {
    let narrow = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return narrow;
      },
      media: query,
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    }));
    function Counter() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>count {n}</button>;
    }
    const panes: [Pane, Pane, Pane] = [PANES[0], { ...PANES[1], content: <Counter /> }, PANES[2]];
    try {
      render(<Panes panes={panes} storageKey="t" />);
      fireEvent.click(screen.getByRole('button', { name: 'count 0' }));
      act(() => {
        narrow = true;
        listeners.forEach((f) => f());
      });
      expect(screen.getAllByRole('tab')).toHaveLength(3);
      expect(screen.queryAllByRole('separator')).toHaveLength(0);
      // Only the selected pane shows (the middle one by default).
      const left = document.querySelector<HTMLElement>('[aria-label="Left"]')!;
      expect(left.getAttribute('role')).toBe('tabpanel');
      expect(left.hidden).toBe(true);
      expect(screen.getByRole('tabpanel', { name: 'Middle' }).hidden).toBe(false);
      // The pane was not remounted: its state survived.
      expect(screen.getByRole('button', { name: 'count 1' })).toBeTruthy();
      fireEvent.click(screen.getByRole('tab', { name: 'Left' }));
      expect(screen.getByRole('tabpanel', { name: 'Left' }).hidden).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('collapses a side pane to a rail and back, keeping its content mounted', () => {
    function Counter() {
      const [n, setN] = useState(0);
      return <button onClick={() => setN(n + 1)}>count {n}</button>;
    }
    const panes: [Pane, Pane, Pane] = [{ ...PANES[0], content: <Counter /> }, PANES[1], PANES[2]];
    const { container } = render(
      <Panes panes={panes} storageKey="t" initialSizes={[30, 40, 30]} />,
    );
    const grid = container.querySelector('.panes') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'count 0' }));
    // The middle pane has no collapse button; the side panes do, own header or not.
    expect(screen.queryByRole('button', { name: 'Hide Middle' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hide Right' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Left' }));
    expect(grid.style.gridTemplateColumns).toBe('var(--pane-rail-w) 1px 40fr 1px 30fr');
    // Only the divider beside an open pane resizes.
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'count 1' })).toBeNull(); // hidden
    expect(JSON.parse(localStorage.getItem('t-collapsed')!)).toEqual([true, false]);
    fireEvent.click(screen.getByRole('button', { name: 'Show Left' }));
    expect(grid.style.gridTemplateColumns).toBe('30fr 1px 40fr 1px 30fr');
    expect(screen.getByRole('button', { name: 'count 1' })).toBeTruthy(); // state kept
  });

  it('hides and shows the side panes with the leader then [ ] and z', () => {
    const { container } = render(
      <LeaderKeys setting="ctrl+b">
        <Panes panes={PANES} storageKey="t" initialSizes={[30, 40, 30]} />
      </LeaderKeys>,
    );
    const grid = container.querySelector('.panes') as HTMLElement;
    const leader = () => fireEvent.keyDown(window, { code: 'KeyB', key: 'b', ctrlKey: true });
    const press = (key: string) => fireEvent.keyDown(window, { key });
    leader();
    expect(screen.getByTestId('leader-waiting').textContent).toContain('Ctrl+B');
    press('[');
    expect(screen.queryByTestId('leader-waiting')).toBeNull();
    expect(grid.style.gridTemplateColumns).toBe('var(--pane-rail-w) 1px 40fr 1px 30fr');
    expect(screen.getByRole('button', { name: 'Show Left' }).title).toBe('Show Left (Ctrl+B [)');
    // Without the leader the keys do nothing.
    press(']');
    expect(grid.style.gridTemplateColumns).toBe('var(--pane-rail-w) 1px 40fr 1px 30fr');
    leader();
    press(']');
    expect(grid.style.gridTemplateColumns).toBe(
      'var(--pane-rail-w) 1px 40fr 1px var(--pane-rail-w)',
    );
    leader();
    press('[');
    expect(grid.style.gridTemplateColumns).toBe('30fr 1px 40fr 1px var(--pane-rail-w)');
    // z hides both, then brings back what was open.
    leader();
    press('Shift'); // modifiers alone keep it waiting
    expect(screen.getByTestId('leader-waiting')).toBeTruthy();
    press('z');
    expect(grid.style.gridTemplateColumns).toBe(
      'var(--pane-rail-w) 1px 40fr 1px var(--pane-rail-w)',
    );
    leader();
    press('z');
    expect(grid.style.gridTemplateColumns).toBe('30fr 1px 40fr 1px var(--pane-rail-w)');
    // Escape and unknown keys stop waiting and do nothing.
    leader();
    press('Escape');
    expect(screen.queryByTestId('leader-waiting')).toBeNull();
    leader();
    press('q');
    expect(screen.queryByTestId('leader-waiting')).toBeNull();
  });

  it('catches the leader and its key before the focused control sees them', () => {
    const typed: string[] = [];
    const panes: [Pane, Pane, Pane] = [
      PANES[0],
      {
        ...PANES[1],
        content: <textarea aria-label="Draft" onKeyDown={(e) => typed.push(e.key)} />,
      },
      PANES[2],
    ];
    render(
      <LeaderKeys setting="ctrl+a">
        <Panes panes={panes} storageKey="t" />
      </LeaderKeys>,
    );
    const draft = screen.getByRole('textbox', { name: 'Draft' });
    fireEvent.keyDown(draft, { code: 'KeyA', key: 'a', ctrlKey: true });
    fireEvent.keyDown(draft, { key: '[' });
    expect(typed).toEqual([]);
    expect(screen.getByRole('button', { name: 'Show Left' })).toBeTruthy();
    // Ctrl+B is not the leader now: it reaches the text box.
    fireEvent.keyDown(draft, { code: 'KeyB', key: 'b', ctrlKey: true });
    expect(typed).toEqual(['b']);
  });

  it('lists the actions on leader ?', () => {
    render(
      <LeaderKeys setting="ctrl+b">
        <Panes panes={PANES} storageKey="t" />
      </LeaderKeys>,
    );
    fireEvent.keyDown(window, { code: 'KeyB', key: 'b', ctrlKey: true });
    fireEvent.keyDown(window, { key: '?' });
    const dialog = screen.getByRole('dialog', { name: 'Leader key actions' });
    expect(dialog.textContent).toContain('Hide or show Left');
    expect(dialog.textContent).toContain('Go to Middle');
    // While a dialog is open the leader is left alone.
    fireEvent.keyDown(window, { code: 'KeyB', key: 'b', ctrlKey: true });
    expect(screen.queryByTestId('leader-waiting')).toBeNull();
  });

  it('goes to a pane with Ctrl+1/2/3 or leader h/l/o (opening it), and F6', () => {
    const panes: [Pane, Pane, Pane] = [
      PANES[0],
      { ...PANES[1], content: <textarea aria-label="Draft" /> },
      PANES[2],
    ];
    render(
      <LeaderKeys setting="ctrl+b">
        <Panes panes={panes} storageKey="t" />
      </LeaderKeys>,
    );
    const region = (name: string) => screen.getByRole('region', { name });
    const leader = (key: string) => {
      fireEvent.keyDown(window, { code: 'KeyB', key: 'b', ctrlKey: true });
      fireEvent.keyDown(window, { key });
    };
    fireEvent.keyDown(window, { code: 'Digit2', key: '2', ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Draft' }));
    // Collapsing the pane with focus hands it to the middle pane.
    fireEvent.keyDown(window, { code: 'Digit1', key: '1', ctrlKey: true });
    expect(region('Left').contains(document.activeElement)).toBe(true);
    leader('[');
    expect(screen.getByRole('button', { name: 'Show Left' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Draft' }));
    // Leader h goes left, opening the pane.
    leader('h');
    expect(region('Left').contains(document.activeElement)).toBe(true);
    leader('l');
    expect(region('Middle').contains(document.activeElement)).toBe(true);
    leader('ArrowRight');
    expect(region('Right').contains(document.activeElement)).toBe(true);
    leader('o');
    expect(region('Left').contains(document.activeElement)).toBe(true);
    leader('[');
    // Ctrl+1 opens it again.
    fireEvent.keyDown(window, { code: 'Digit1', key: '1', ctrlKey: true });
    expect(screen.queryByRole('button', { name: 'Show Left' })).toBeNull();
    expect(region('Left').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: 'F6' });
    expect(region('Middle').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: 'F6' });
    expect(region('Right').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: 'F6' });
    expect(region('Left').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: 'F6', shiftKey: true });
    expect(region('Right').contains(document.activeElement)).toBe(true);
  });
});
