import { useMemo } from 'react';
import { renderMarkdown } from '../lib/markdown';

/** Markdown rendered through the sanitiser in lib/markdown; raw HTML is dropped. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return (
    <div
      className={className ? `md ${className}` : 'md'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
