/**
 * A segmented control for 2–4 exclusive options (dialog tabs, theme,
 * "This problem / General"). Each option is a button with `aria-pressed`, so
 * it keeps the role and name a plain button has (tests and the guide find it
 * by name). Arrow keys, Home and End move the selection like a radio group;
 * only the selected option is in the tab order.
 *
 * With `tabs` the same control is a WAI-ARIA tablist instead (`tab` options
 * with `aria-selected`), for options that switch a panel, such as the New
 * problem dialog's Generate / Paste / Import (T33).
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string | undefined;
  disabled?: boolean | undefined;
}

export interface SegmentedProps<T extends string> {
  'aria-label': string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string | undefined;
  /** Render as a tablist of tabs (each may name its panel in `controls`). */
  tabs?: boolean | undefined;
  /** With `tabs`: the id of the panel each option shows, by value. */
  controls?: Partial<Record<T, string>> | undefined;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  tabs,
  controls,
  'aria-label': label,
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 && !options[selected]?.disabled ? selected : (enabled[0] ?? -1);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const at = enabled.indexOf(index);
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(at + 1) % enabled.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    const option = options[next];
    if (option && option.value !== value) onChange(option.value);
  }

  return (
    <div
      role={tabs ? 'tablist' : 'group'}
      aria-label={label}
      className={['ui-segmented', className ?? ''].filter(Boolean).join(' ')}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          {...(tabs
            ? {
                role: 'tab',
                'aria-selected': o.value === value,
                'aria-controls': controls?.[o.value],
              }
            : { 'aria-pressed': o.value === value })}
          tabIndex={i === tabStop ? 0 : -1}
          title={o.title}
          disabled={o.disabled}
          onClick={() => {
            if (o.value !== value) onChange(o.value);
          }}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
