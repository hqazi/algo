/**
 * The header every pane on a multi-pane page shares (T29, docs/design.md →
 * App frame): one height, the pane's title, then its actions. Put a
 * `<span className="spacer" />` among the children to push the rest right.
 * In a collapsible pane it ends with the collapse button.
 */
import type { ReactNode } from 'react';
import { PanelLeftClose, PanelRightClose } from 'lucide-react';
import { usePaneControl } from './pane-control';
import { IconButton } from './ui';

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
  const control = usePaneControl();
  const Icon = control?.side === 'right' ? PanelRightClose : PanelLeftClose;
  return (
    <div className={className ? `pane-header ${className}` : 'pane-header'}>
      <h2 className="pane-title" id={titleId}>
        {title}
      </h2>
      {children}
      {control && (
        <IconButton
          className="pane-collapse"
          size="sm"
          aria-label={`Hide ${control.title}`}
          title={
            control.shortcut
              ? `Hide ${control.title} (${control.shortcut})`
              : `Hide ${control.title}`
          }
          icon={<Icon aria-hidden="true" />}
          onClick={control.collapse}
        />
      )}
    </div>
  );
}
