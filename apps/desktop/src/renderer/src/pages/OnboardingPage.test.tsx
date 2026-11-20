// @vitest-environment jsdom
/**
 * Onboarding (T09, SPEC §2): the five questions are saved in one call, then
 * the "Connect the tutor" step takes a key (tested) or is skipped; with a
 * tutor already available the step is skipped. The questions come one per
 * step (T33), with Back / Continue and "Use defaults and start" on each.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppProvider } from '../lib/app';
import { FakeBridge, installBridge } from '../test/fake-bridge';
import { baseHandlers, KEY_NONE, PROFILE, TOPICS, TUTOR_OFF, TUTOR_ON } from '../test/fixtures';
import { OnboardingPage } from './OnboardingPage';

function renderPage(bridge: FakeBridge) {
  installBridge(bridge);
  return render(
    <AppProvider>
      <OnboardingPage />
    </AppProvider>,
  );
}

function bridge(tutorAfterKey = true): FakeBridge {
  let keyed = false;
  return baseHandlers(new FakeBridge(), { onboarded: false, profile: null })
    .on('profile:set', () => PROFILE)
    .on('profile:defaults', () => PROFILE)
    .on('tutor:status', () => (keyed && tutorAfterKey ? TUTOR_ON : TUTOR_OFF))
    .on('secrets:set-key', () => {
      keyed = true;
      return { ...KEY_NONE, source: 'stored', hint: '…WXYZ', stored: true };
    })
    .on('tutor:test', () => ({ ok: true, kind: null, message: 'Connected.', model: 'm' }));
}

beforeEach(() => window.history.replaceState(null, '', '/index.html#/welcome'));
afterEach(cleanup);

describe('OnboardingPage', () => {
  it('saves the answers in one call, then connects the tutor and goes home', async () => {
    const b = bridge();
    renderPage(b);
    await screen.findByRole('heading', { name: 'Welcome' });
    const step = () => screen.getByTestId('step-indicator').textContent;
    const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(step()).toBe('Question 1 of 5');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Preparing for interviews'));
    fireEvent.change(screen.getByLabelText('Interview date (optional)'), {
      target: { value: '2027-01-15' },
    });
    next();
    expect(step()).toBe('Question 2 of 5');
    // Back keeps the answers given so far.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText('Preparing for interviews') as HTMLInputElement).checked).toBe(
      true,
    );
    next();
    fireEvent.click(screen.getByLabelText('Intermediate'));
    expect(
      screen.getByRole('radio', { name: 'Intermediate' }).getAttribute('aria-describedby'),
    ).toBeTruthy();
    next();
    fireEvent.change(screen.getByRole('combobox', { name: 'Comfort: basics' }), {
      target: { value: 'solid' },
    });
    next();
    fireEvent.click(screen.getByLabelText('Let me struggle first'));
    // "Use defaults and start" is on every step.
    expect(screen.getByRole('button', { name: 'Use defaults and start' })).toBeTruthy();
    next();
    expect(step()).toBe('Question 5 of 5');
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Focus topic' }), {
      target: { value: 'hashing' },
    });
    expect(b.calls.some((c) => c.channel === 'profile:set')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await screen.findByRole('heading', { name: 'Connect the tutor' });
    const saved = b.calls.filter((c) => c.channel === 'profile:set').map((c) => c.request);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({
      goal: 'interview',
      interview_date: '2027-01-15',
      experience: 'intermediate',
      // One entry per topic group in the catalog.
      comfort: Object.fromEntries(
        [...new Set(TOPICS.map((t) => t.group))].map((g) => [g, g === 'basics' ? 'solid' : 'none']),
      ),
      hint_preference: 'struggle',
      focus_topic: 'hashing',
    });

    fireEvent.change(screen.getByLabelText('Anthropic API key'), {
      target: { value: 'sk-ant-test-0000000000000000000000-WXYZ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
  });

  it('"use defaults" with a tutor already available skips the tutor step', async () => {
    const b = baseHandlers(new FakeBridge(), { onboarded: false, profile: null })
      .on('profile:defaults', () => PROFILE)
      .on('tutor:status', () => TUTOR_ON);
    renderPage(b);
    fireEvent.click(await screen.findByRole('button', { name: 'Use defaults and start' }));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    expect(screen.queryByRole('heading', { name: 'Connect the tutor' })).toBeNull();
  });

  it('the tutor step can be skipped', async () => {
    renderPage(bridge(false));
    fireEvent.click(await screen.findByRole('button', { name: 'Use defaults and start' }));
    await screen.findByRole('heading', { name: 'Connect the tutor' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(window.location.hash).toBe('#/'));
  });
});
