// @vitest-environment jsdom
/** Panes (T29): a shared header per pane, 1px dividers resizable by keyboard. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaneHeader } from './PaneHeader';
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
});
