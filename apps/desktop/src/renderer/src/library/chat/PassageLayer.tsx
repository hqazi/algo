/**
 * Chats in the reader's margin (T24, SPEC §15.5, §15.6): **Ask about this**
 * on a selection in the article body, a button beside each heading, and a
 * marker beside each thread's passage. Anchors are resolved against the
 * rendered body with core's resolver; a thread whose passage is gone is
 * reported detached (the chat pane lists it without a position).
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  anchorFromHeading,
  anchorFromRange,
  parseAnchor,
  resolveAnchor,
  type AnchorState,
} from '@algo/core';
import type { AnchorView } from '../../../../shared/article-chat';
import { domDoc, offsetOf, rangeOf, type DomDoc } from './dom-doc';
import type { ArticleChats } from './useArticleChats';
import './article-chat.css';

export interface PassageLayerProps {
  /** The reader's `.article-body`, once rendered. */
  body: HTMLElement | null;
  /** Changes whenever the body's HTML does. */
  html: string;
  chats: ArticleChats;
  /** The user chose a passage. */
  onAsk: (anchor: AnchorView) => void;
}

interface Marker {
  id: string;
  top: number;
  title: string;
  state: AnchorState;
}

/** Top of a range or element relative to the reader (0 where layout is unavailable, e.g. jsdom). */
function topOf(target: Range | Element, origin: Element): number {
  if (typeof target.getBoundingClientRect !== 'function') return 0;
  const r = target.getBoundingClientRect();
  return Math.max(0, r.top - origin.getBoundingClientRect().top);
}

interface Measured {
  doc: DomDoc | null;
  markers: Marker[];
  headingTops: number[];
  states: Record<string, AnchorState>;
}

const EMPTY: Measured = { doc: null, markers: [], headingTops: [], states: {} };

function measure(
  body: HTMLElement | null,
  origin: Element | null,
  threads: ArticleChats['threads'],
): Measured {
  if (!body || !origin) return EMPTY;
  const doc = domDoc(body);
  const states: Record<string, AnchorState> = {};
  const markers: Marker[] = [];
  for (const t of threads) {
    const anchor = parseAnchor(t.anchor);
    const r = anchor ? resolveAnchor(doc, anchor) : null;
    const state = r?.state ?? 'detached';
    states[t.id] = state;
    if (!r || state === 'detached') continue;
    const target =
      state === 'quote' ? rangeOf(doc, r.start, r.end) : (doc.headingEls[r.heading!] ?? null);
    markers.push({
      id: t.id,
      top: target ? topOf(target, origin) : 0,
      title: t.title ?? 'New question',
      state,
    });
  }
  return { doc, markers, headingTops: doc.headingEls.map((h) => topOf(h, origin)), states };
}

export function PassageLayer({ body, html, chats, onAsk }: PassageLayerProps) {
  const [measured, setMeasured] = useState<Measured>(EMPTY);
  const [selection, setSelection] = useState<{ anchor: AnchorView; top: number } | null>(null);
  const [layout, setLayout] = useState(0);
  const { threads, setStates } = chats;
  const origin = body?.closest('.reader') ?? null;
  const { doc, markers, headingTops } = measured;

  // New HTML: a selection in the old body is gone.
  const [shownHtml, setShownHtml] = useState(html);
  if (shownHtml !== html) {
    setShownHtml(html);
    setSelection(null);
  }

  // Re-measure when the reader's width changes (text reflows).
  useEffect(() => {
    if (!body || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setLayout((n) => n + 1));
    ro.observe(body);
    return () => ro.disconnect();
  }, [body]);

  // Reads the rendered body (it exists only after commit), resolves every
  // thread's anchor against it and measures where markers go.
  useLayoutEffect(() => {
    const next = measure(body, origin, threads);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- layout read from the committed DOM
    setMeasured(next);
    setStates(next.states);
  }, [body, html, origin, threads, setStates, layout]);

  const readSelection = useCallback(() => {
    if (!body || !doc || !origin) return;
    const sel = body.ownerDocument.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setSelection(null);
    const range = sel.getRangeAt(0);
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer))
      return setSelection(null);
    const start = offsetOf(doc, range.startContainer, range.startOffset);
    const end = offsetOf(doc, range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) return setSelection(null);
    const anchor = anchorFromRange(doc, start, end);
    if (!anchor.quote) return setSelection(null);
    setSelection({ anchor, top: topOf(range, origin) });
  }, [body, doc, origin]);

  useEffect(() => {
    if (!body) return;
    const onUp = () => readSelection();
    body.addEventListener('mouseup', onUp);
    body.addEventListener('keyup', onUp);
    return () => {
      body.removeEventListener('mouseup', onUp);
      body.removeEventListener('keyup', onUp);
    };
  }, [body, readSelection]);

  if (!doc) return null;
  return (
    <div className="passage-layer" data-testid="passage-layer">
      {selection && (
        <button
          type="button"
          className="ask-selection primary small-button"
          style={{ top: selection.top }}
          // Keep the selection while clicking.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onAsk(selection.anchor);
            setSelection(null);
            body?.ownerDocument.getSelection()?.removeAllRanges();
          }}
        >
          Ask about this
        </button>
      )}
      {doc.headings.map((h, i) => (
        <button
          key={`h${i}`}
          type="button"
          className="ask-heading"
          style={{ top: headingTops[i] ?? 0 }}
          aria-label={`Ask about the section “${h.title}”`}
          title="Ask the tutor about this section"
          onClick={() => onAsk(anchorFromHeading(doc, i))}
        >
          Ask
        </button>
      ))}
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`passage-marker${chats.open === m.id ? ' active' : ''}${m.state === 'heading' ? ' at-heading' : ''}`}
          style={{ top: m.top }}
          aria-label={`Open chat: ${m.title}`}
          title={m.title}
          data-testid="passage-marker"
          onClick={() => chats.openThread(m.id)}
        />
      ))}
    </div>
  );
}
