// @vitest-environment jsdom
/** The title bar (T29): navigation, actions, tutor status, hidden during onboarding. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TutorStatusView } from '../../../shared/tutor';
import { TitleBar } from './AppFrame';
import { tutorTooltip } from './app-frame';

afterEach(cleanup);

const ON: TutorStatusView = { backend: 'anthropic', available: true, reason: null, model: 'm-1' };
const OFF: TutorStatusView = {
  backend: 'none',
  available: false,
  reason: 'No API key.',
  model: null,
};

function bar(props: Partial<Parameters<typeof TitleBar>[0]> = {}) {
  const onNext = vi.fn();
  const onNew = vi.fn();
  render(
    <TitleBar
      route={{ name: 'progress' }}
      onboarding={false}
      tutor={ON}
      nextBusy={false}
      onNext={onNext}
      onNew={onNew}
      {...props}
    />,
  );
  return { onNext, onNew };
}

describe('TitleBar', () => {
  it('shows the name, the nav links and the two actions by their names', () => {
    const { onNext, onNew } = bar();
    expect(screen.getByRole('link', { name: 'Algo' }).getAttribute('href')).toBe('#/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const names = [...nav.querySelectorAll('a')].map((a) => a.textContent);
    expect(names).toEqual(['Home', 'Problems', 'Progress', 'Library', 'Settings']);
    for (const name of names) expect(screen.getByRole('link', { name: name! })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next problem' }));
    fireEvent.click(screen.getByRole('button', { name: 'New problem' }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onNew).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Next problem' }).className).toContain('btn-primary');
    expect(screen.getByRole('button', { name: 'New problem' }).className).toContain(
      'btn-secondary',
    );
  });

  it('marks the current page, and Problems while practising', () => {
    bar();
    const progress = screen.getByRole('link', { name: 'Progress' });
    expect(progress.getAttribute('aria-current')).toBe('page');
    expect(progress.className).toBe('nav active');
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
    cleanup();
    bar({ route: { name: 'problem', slug: 'two-sum' } });
    expect(screen.getByRole('link', { name: 'Problems' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('shows the tutor as a dot and "Tutor", on or off for screen readers, with a tooltip', () => {
    bar();
    const status = screen.getByTestId('tutor-status');
    expect(status.textContent).toBe('Tutor on');
    expect(status.getAttribute('title')).toBe('Tutor on: Anthropic API, model m-1');
    cleanup();
    bar({ tutor: OFF });
    expect(screen.getByTestId('tutor-status').textContent).toBe('Tutor off');
    expect(screen.getByTestId('tutor-status').getAttribute('title')).toBe('Tutor off: No API key.');
  });

  it('shows "Picking…" and disables Next problem while busy', () => {
    bar({ nextBusy: true });
    expect(screen.getByRole('button', { name: 'Picking…' }).hasAttribute('disabled')).toBe(true);
  });

  it('hides the nav, the actions and the status during onboarding', () => {
    bar({ onboarding: true, route: { name: 'welcome' } });
    expect(screen.getByRole('link', { name: 'Algo' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('tutor-status')).toBeNull();
  });
});

describe('tutorTooltip', () => {
  it('names the backend, and the model when there is one', () => {
    expect(tutorTooltip({ ...ON, backend: 'claude-code', model: null })).toBe(
      'Tutor on: Claude Code',
    );
    expect(tutorTooltip({ ...OFF, reason: null })).toBe('Tutor off');
  });
});
