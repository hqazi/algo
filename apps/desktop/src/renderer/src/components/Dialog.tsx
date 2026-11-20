/**
 * A modal dialog in the shared look (docs/design.md → Dialogs): `--radius-lg`,
 * `--shadow-lg`, a header with the title and a close icon button, a body
 * that scrolls, and footer actions on the right. With `onSubmit` the body
 * and footer are one form, so Enter submits and the footer's submit button
 * belongs to it. Escape and the close button call `onClose`; a click on the
 * backdrop does too unless `backdropCloses` is false.
 */
import { X } from 'lucide-react';
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { IconButton } from './ui';

export interface DialogProps {
  /** The id of the title, for `aria-labelledby` (tests and CSS may use it). */
  titleId: string;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** Wider dialogs (forms with lists, previews). */
  wide?: boolean;
  backdropCloses?: boolean;
  className?: string;
  /** Extra controls in the header, before the close button. */
  headerActions?: ReactNode;
}

export function Dialog({
  titleId,
  title,
  onClose,
  children,
  footer,
  onSubmit,
  wide,
  backdropCloses = true,
  className,
  headerActions,
}: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // Focus moves into the dialog when it opens and back where it was after.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>(
        '.dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-body button',
      );
      (first ?? el).focus();
    }
    return () => before?.focus?.();
  }, []);

  const body = (
    <>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-footer">{footer}</div>}
    </>
  );

  return (
    <div className="modal-backdrop" onClick={backdropCloses ? onClose : undefined}>
      <div
        ref={box}
        className={['modal', 'dialog', wide ? 'wide' : '', className ?? ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close.current();
          }
        }}
      >
        <div className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          {headerActions}
          <IconButton aria-label="Close" icon={<X aria-hidden="true" />} onClick={onClose} />
        </div>
        {onSubmit ? (
          <form className="dialog-form" onSubmit={onSubmit}>
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>
  );
}
