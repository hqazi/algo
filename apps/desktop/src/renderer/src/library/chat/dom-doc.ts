/**
 * The reader's rendered body as core's `AnchorDoc` (T24): its text nodes
 * concatenated (a line break between blocks), and its headings at offsets
 * into that text. Turns a DOM selection into offsets for an anchor, and an
 * anchor's offsets back into a DOM range for its margin marker.
 */
import { normalizeSpace, type AnchorDoc } from '@algo/core';

export interface DomDoc extends AnchorDoc {
  /** Each text node and the offset of its first character in `text`. */
  nodes: { node: Text; start: number }[];
  /** The heading elements, in the order of `headings`. */
  headingEls: HTMLElement[];
}

const BLOCK = 'P,LI,UL,OL,BLOCKQUOTE,PRE,TABLE,TR,TD,TH,H1,H2,H3,H4,H5,H6,DIV,SECTION,DT,DD,FIGURE';

const blockOf = (n: Node, root: Element): Element => {
  let el = n.parentElement;
  while (el && el !== root && !BLOCK.split(',').includes(el.tagName)) el = el.parentElement;
  return el ?? root;
};

export function domDoc(root: HTMLElement): DomDoc {
  const nodes: DomDoc['nodes'] = [];
  const headingEls: HTMLElement[] = [];
  const headings: DomDoc['headings'] = [];
  let text = '';
  let lastBlock: Element | null = null;
  const seen = new Set<Element>();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const block = blockOf(t, root);
    if (lastBlock && block !== lastBlock) text += '\n';
    lastBlock = block;
    const h = t.parentElement?.closest('h1,h2,h3,h4,h5,h6');
    if (h && root.contains(h) && !seen.has(h)) {
      seen.add(h);
      const title = normalizeSpace(h.textContent ?? '');
      if (title) {
        headingEls.push(h as HTMLElement);
        headings.push({ level: Number(h.tagName.slice(1)), title, start: text.length });
      }
    }
    nodes.push({ node: t, start: text.length });
    text += t.data;
  }
  return { text, headings, nodes, headingEls };
}

/** A DOM point (as a selection gives it) as an offset into `doc.text`, or `null` outside it. */
export function offsetOf(doc: DomDoc, container: Node, offset: number): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const entry = doc.nodes.find((x) => x.node === container);
    return entry ? entry.start + Math.min(offset, (container as Text).data.length) : null;
  }
  // An element point: the first text node at or after its `offset`-th child.
  const ref = container.childNodes[offset] ?? null;
  const F = Node.DOCUMENT_POSITION_FOLLOWING;
  const C = Node.DOCUMENT_POSITION_CONTAINED_BY;
  for (const x of doc.nodes) {
    const pos = (ref ?? container).compareDocumentPosition(x.node);
    // Inside or after the child; past the container's end when there is none.
    if (ref ? ref === x.node || pos & F : pos & F && !(pos & C)) return x.start;
  }
  return doc.text.length;
}

/** A DOM range for offsets into `doc.text`, or `null`. */
export function rangeOf(doc: DomDoc, start: number, end: number): Range | null {
  const point = (off: number, isEnd: boolean): [Text, number] | null => {
    for (const [i, x] of doc.nodes.entries()) {
      const len = x.node.data.length;
      const next = doc.nodes[i + 1]?.start ?? Infinity;
      if (off >= x.start && (off < x.start + len || (isEnd && off === x.start + len)))
        return [x.node, off - x.start];
      if (off < next && off >= x.start + len) return [x.node, len];
    }
    return null;
  };
  const a = point(start, false);
  const b = point(end, true);
  if (!a || !b) return null;
  const r = a[0].ownerDocument.createRange();
  r.setStart(a[0], a[1]);
  r.setEnd(b[0], b[1]);
  return r;
}
