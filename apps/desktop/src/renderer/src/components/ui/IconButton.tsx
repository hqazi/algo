/**
 * An icon-only button. `aria-label` is required and is also the tooltip
 * (`title`) unless one is given, so the button keeps an accessible name for
 * keyboard and screen-reader users, the e2e tests and the user guide.
 */
import { Button, type ButtonProps } from './Button';

export interface IconButtonProps extends Omit<ButtonProps, 'aria-label' | 'children' | 'icon'> {
  'aria-label': string;
  /** The icon (decorative; lucide icons are `aria-hidden` without a label of their own). */
  icon: ButtonProps['icon'];
}

export function IconButton({ icon, title, variant = 'icon', ...rest }: IconButtonProps) {
  return (
    <Button variant={variant} title={title ?? rest['aria-label']} {...rest}>
      {icon}
    </Button>
  );
}
