import type { ReactNode } from 'react';
import { linkClick } from '../lib/router';

/** An in-app link; `to` is a route path such as `/p/two-sum`. */
export function Link(props: {
  to: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <a href={`#${props.to}`} className={props.className} title={props.title} onClick={linkClick}>
      {props.children}
    </a>
  );
}
