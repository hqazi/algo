/**
 * A minimal hash router (ported from `dsa-tutor/web/src/lib/router.ts`).
 * The UI is served from `tutor-app://app/index.html`, which has no fallback
 * for other paths, so routes live in the hash: `#/p/<slug>`. Reload keeps the
 * route.
 */
import { useEffect, useState, type MouseEvent } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'welcome' }
  | { name: 'problems' }
  | { name: 'problem'; slug: string }
  | { name: 'progress' }
  | { name: 'settings' }
  | { name: 'library'; article: string | null }
  | { name: 'not_found'; path: string };

const SLUG = '([a-z0-9]+(?:-[a-z0-9]+)*)';

export function parse(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/') return { name: 'home' };
  if (p === '/welcome') return { name: 'welcome' };
  if (p === '/problems') return { name: 'problems' };
  if (p === '/progress') return { name: 'progress' };
  if (p === '/settings') return { name: 'settings' };
  if (p === '/library') return { name: 'library', article: null };
  const lib = /^\/library\/([A-Za-z0-9_-]{1,100})$/.exec(p);
  if (lib) return { name: 'library', article: lib[1]! };
  const m = new RegExp(`^/p/${SLUG}$`).exec(p);
  if (m) return { name: 'problem', slug: m[1]! };
  return { name: 'not_found', path: p };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'problem':
      return `/p/${route.slug}`;
    case 'library':
      return route.article ? `/library/${route.article}` : '/library';
    case 'not_found':
      return route.path;
    default:
      return `/${route.name}`;
  }
}

/** The current route path (`/p/x`), from the hash. */
export function currentPath(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
}

export function navigate(to: string | Route, replace = false): void {
  const path = typeof to === 'string' ? to : href(to);
  if (path === currentPath()) return;
  const url = `${window.location.pathname}${window.location.search}#${path}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(currentPath()));
  useEffect(() => {
    const update = (): void => setRoute(parse(currentPath()));
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return route;
}

/** onClick for `<a href="#/...">`: client-side navigation unless a modified click. */
export function linkClick(e: MouseEvent<HTMLAnchorElement>): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  const url = e.currentTarget.getAttribute('href');
  if (!url?.startsWith('#/')) return;
  e.preventDefault();
  navigate(url.slice(1));
}
