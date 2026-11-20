/**
 * The header every pane on a multi-pane page shares (T29, docs/design.md →
 * App frame): one height, the pane's title, then its actions. Put a
 * `<span className="spacer" />` among the children to push the rest right.
 */
import type { ReactNode } from 'react';

export function PaneHeader({
  title,
  titleId,
  className,
  children,
}: {
  title: ReactNode;
  titleId?: string | undefined;
  className?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div className={className ? `pane-header ${className}` : 'pane-header'}>
      <h2 className="pane-title" id={titleId}>
        {title}
      </h2>
      {children}
    </div>
  );
}
