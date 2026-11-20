/**
 * A native <select> (keyboard and screen readers as usual) without the native
 * look: `appearance: none` and a chevron icon. A bare <select> elsewhere gets
 * the same look from styles.css with a CSS chevron.
 */
import type { ComponentPropsWithRef } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  /** Class for the wrapper (width, margins); `className` goes on the <select>. */
  wrapperClassName?: string | undefined;
}

export function Select({ wrapperClassName, children, ...rest }: SelectProps) {
  return (
    <span className={['ui-select', wrapperClassName ?? ''].filter(Boolean).join(' ')}>
      <select {...rest}>{children}</select>
      <ChevronDown className="ui-select-chevron" size={16} aria-hidden="true" />
    </span>
  );
}
