/**
 * A textarea that grows with its content up to `maxHeight` (then scrolls)
 * instead of showing a resize grip. Works controlled (`value`) or
 * uncontrolled.
 */
import { useCallback, useLayoutEffect, useRef, type ComponentPropsWithRef, type Ref } from 'react';

export interface AutoGrowTextareaProps extends ComponentPropsWithRef<'textarea'> {
  /** Tallest the box grows, in px, before it scrolls. Default 240. */
  maxHeight?: number | undefined;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

export function AutoGrowTextarea({
  maxHeight = 240,
  className,
  rows = 1,
  onInput,
  ref,
  ...rest
}: AutoGrowTextareaProps) {
  const el = useRef<HTMLTextAreaElement | null>(null);

  const fit = useCallback(() => {
    const t = el.current;
    if (!t) return;
    t.style.height = 'auto';
    const borders = t.offsetHeight - t.clientHeight;
    const wanted = t.scrollHeight + Math.max(0, borders);
    t.style.height = `${Math.min(wanted, maxHeight)}px`;
    t.style.overflowY = wanted > maxHeight ? 'auto' : 'hidden';
  }, [maxHeight]);

  useLayoutEffect(fit, [fit, rest.value]);

  return (
    <textarea
      {...rest}
      rows={rows}
      ref={(t) => {
        el.current = t;
        assignRef(ref, t);
      }}
      className={['ui-autogrow', className ?? ''].filter(Boolean).join(' ')}
      onInput={(e) => {
        fit();
        onInput?.(e);
      }}
    />
  );
}
