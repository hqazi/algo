/** Class names for the `ui/` controls (kept apart from components for fast refresh). */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** The classes for a button of this variant and size (`.btn`, `.btn-primary`, `.btn-sm`, ...). */
export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  extra?: string,
): string {
  return ['btn', `btn-${variant}`, size === 'md' ? '' : `btn-${size}`, extra ?? '']
    .filter(Boolean)
    .join(' ');
}
