/**
 * A menu (popover) for overflow actions, following the WAI-ARIA menu button
 * pattern: the trigger has `aria-haspopup="menu"` and `aria-expanded`; Enter,
 * Space or ArrowDown open it on the first item, ArrowUp on the last.
 * In the menu: ArrowDown/ArrowUp (wrapping), Home, End and a typed letter
 * move focus; Enter or Space choose; Escape closes and returns focus to the
 * trigger; Tab or a click outside closes it.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { buttonClass, type ButtonVariant } from './classes';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  disabled?: boolean | undefined;
  danger?: boolean | undefined;
  title?: string | undefined;
}

export interface MenuProps {
  /** The trigger's accessible name (and tooltip when it shows only an icon). */
  label: string;
  items: readonly MenuItem[];
  /** Visible trigger content; defaults to a "more" icon. */
  trigger?: ReactNode;
  triggerVariant?: ButtonVariant | undefined;
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end' | undefined;
  disabled?: boolean | undefined;
}

export function Menu({
  label,
  items,
  trigger,
  triggerVariant,
  align = 'end',
  disabled,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [focusOnOpen, setFocusOnOpen] = useState<'first' | 'last'>('first');
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  function focusItem(index: number | undefined): void {
    if (index !== undefined) itemRefs.current[index]?.focus();
  }

  useEffect(() => {
    if (!open) return;
    focusItem(focusOnOpen === 'first' ? enabled[0] : enabled[enabled.length - 1]);
    const onPointerDown = (e: PointerEvent | MouseEvent): void => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
    // Focus once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openAt(where: 'first' | 'last'): void {
    setFocusOnOpen(where);
    setOpen(true);
  }

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openAt('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt('last');
    }
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>): void {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const at = enabled.indexOf(current);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(enabled[(at + 1) % enabled.length]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(enabled[(at - 1 + enabled.length) % enabled.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(enabled[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(enabled[enabled.length - 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      const order = [...enabled.slice(at + 1), ...enabled.slice(0, at + 1)];
      focusItem(order.find((i) => items[i]?.label.toLowerCase().startsWith(ch)));
    }
  }

  const iconOnly = trigger === undefined;
  return (
    <span className="ui-menu-anchor" ref={anchor}>
      <button
        ref={button}
        id={`${id}-trigger`}
        type="button"
        className={buttonClass(triggerVariant ?? (iconOnly ? 'icon' : 'secondary'))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openAt('first'))}
        onKeyDown={onTriggerKey}
      >
        {iconOnly ? <MoreHorizontal size={16} aria-hidden="true" /> : trigger}
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-trigger`}
          className="ui-menu"
          data-align={align}
          onKeyDown={onMenuKey}
        >
          {items.map((it, i) => (
            <button
              key={it.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={['ui-menu-item', it.danger ? 'danger' : ''].filter(Boolean).join(' ')}
              disabled={it.disabled}
              title={it.title}
              onClick={() => {
                close(true);
                it.onSelect();
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
