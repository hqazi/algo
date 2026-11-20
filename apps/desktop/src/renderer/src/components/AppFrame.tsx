/**
 * The window's title bar (T29, docs/design.md → App frame): logo mark and
 * name, the navigation, New problem / Next problem and the tutor status. The
 * main process hides the native title bar (window.ts); the bar is a drag
 * region and its controls are not. macOS keeps its traffic lights on the
 * left; Windows and Linux draw the window controls on the right, over the
 * area `env(titlebar-area-*)` leaves out. During onboarding only the name
 * shows.
 */
import { APP_NAME } from '@algo/core';
import {
  ArrowRight,
  BookOpen,
  ChartNoAxesColumn,
  House,
  ListChecks,
  Plus,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { TutorStatusView } from '../../../shared/tutor';
import type { Route } from '../lib/router';
import { tutorTooltip, windowPlatform } from './app-frame';
import { Link } from './Link';
import { Button } from './ui';

const NAV: { to: string; label: string; icon: LucideIcon; active: Route['name'][] }[] = [
  { to: '/', label: 'Home', icon: House, active: ['home'] },
  { to: '/problems', label: 'Problems', icon: ListChecks, active: ['problems', 'problem'] },
  { to: '/progress', label: 'Progress', icon: ChartNoAxesColumn, active: ['progress'] },
  { to: '/library', label: 'Library', icon: BookOpen, active: ['library'] },
  { to: '/settings', label: 'Settings', icon: Settings, active: ['settings'] },
];

/** The logo (docs/assets/logo.svg), simplified to read at 20px. */
export function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 1024 1024" width="20" height="20" aria-hidden="true">
      <rect x="32" y="32" width="960" height="960" rx="220" fill="#1f3b69" />
      <g stroke-linecap="round" stroke-width="64" fill="none">
        <path d="M512 270 L300 530 L230 770" stroke="#e8eef8" strokeOpacity="0.6" />
        <path d="M512 270 L724 530 L810 770" stroke="#f5be45" />
      </g>
      <circle cx="300" cy="530" r="78" fill="#e8eef8" />
      <circle cx="230" cy="770" r="70" fill="#e8eef8" />
      <circle cx="512" cy="270" r="96" fill="#f5be45" />
      <circle cx="724" cy="530" r="78" fill="#f5be45" />
      <circle cx="810" cy="770" r="84" fill="#f5be45" />
    </svg>
  );
}

function TutorState({ tutor }: { tutor: TutorStatusView }) {
  const on = tutor.available;
  return (
    <span
      className={on ? 'tutor-status on' : 'tutor-status off'}
      title={tutorTooltip(tutor)}
      data-testid="tutor-status"
    >
      <span className="status-dot" aria-hidden="true" />
      Tutor<span className="sr-only">{on ? ' on' : ' off'}</span>
    </span>
  );
}

export function TitleBar({
  route,
  onboarding,
  tutor,
  nextBusy,
  onNext,
  onNew,
}: {
  route: Route;
  /** First run (or no profile yet): only the name shows. */
  onboarding: boolean;
  tutor: TutorStatusView | null;
  nextBusy: boolean;
  onNext: () => void;
  onNew: () => void;
}) {
  return (
    <header className="titlebar" data-platform={windowPlatform()}>
      <Link to="/" className="brand">
        <LogoMark />
        <span>{APP_NAME}</span>
      </Link>
      {!onboarding && (
        <>
          <nav aria-label="Main" className="titlebar-nav">
            {NAV.map(({ to, label, icon: Icon, active }) => {
              const current = active.includes(route.name);
              return (
                <Link
                  key={to}
                  to={to}
                  className={current ? 'nav active' : 'nav'}
                  aria-current={current ? 'page' : undefined}
                  title={label}
                >
                  <Icon aria-hidden="true" />
                  <span className="nav-label">{label}</span>
                </Link>
              );
            })}
          </nav>
          <span className="titlebar-spacer" />
          <div className="titlebar-actions">
            <Button size="sm" icon={<Plus aria-hidden="true" />} onClick={onNew}>
              New problem
            </Button>
            <Button size="sm" variant="primary" onClick={onNext} disabled={nextBusy}>
              {nextBusy ? 'Picking…' : 'Next problem'}
              <ArrowRight aria-hidden="true" />
            </Button>
            {tutor && <TutorState tutor={tutor} />}
          </div>
        </>
      )}
    </header>
  );
}
