/**
 * Buttons (design.md → Controls): `primary` (filled accent), `secondary`
 * (surface + border), `ghost` (no border, hover fill), `danger`, `icon`
 * (square ghost); sizes `sm` (28px), `md` (32px), `lg` (40px). The look lives
 * in styles.css (`.btn-*`). `type` defaults to "button".
 */
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { buttonClass, type ButtonSize, type ButtonVariant } from './classes';

export type { ButtonSize, ButtonVariant };

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /** A decorative icon before the label (16px, from lucide-react). */
  icon?: ReactNode;
}

export function Button({
  variant,
  size,
  icon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}
