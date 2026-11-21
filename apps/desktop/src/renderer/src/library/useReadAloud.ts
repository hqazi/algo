/**
 * Read aloud (T37, SPEC §15.6, D-58): the reader's text through the Web
 * Speech API, so the system's own voices, offline; nothing leaves the
 * computer. One utterance per chunk (`speech.ts`); the block being read gets
 * the `speaking` class and is kept in view. Pause cancels and remembers the
 * chunk (engine pause is unreliable on Linux and some Windows voices), so
 * resume and a change of speed or voice start that chunk again. Voice and
 * speed are UI preferences of this computer (voices differ per system), kept
 * in `localStorage`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStored } from '../lib/hooks';
import { blockAt, speechBlocks, type SpeechBlock } from './speech';

export type ReadAloudStatus = 'idle' | 'playing' | 'paused';

export interface ReadAloudPrefs {
  rate: number;
  /** `SpeechSynthesisVoice.voiceURI`, or null for the system default. */
  voice: string | null;
}

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export interface ReadAloud {
  /** False when the system has no speech engine or no voice. */
  available: boolean;
  status: ReadAloudStatus;
  /** The block being read (0-based) and how many there are; null when idle. */
  at: { block: number; of: number } | null;
  voices: SpeechSynthesisVoice[];
  prefs: ReadAloudPrefs;
  /** The reader's body, after each render of it (the blocks are found again). */
  attach: (body: HTMLElement | null) => void;
  /** Starts from the selection's paragraph if there is one, else from the top. */
  start: () => void;
  toggle: () => void;
  stop: () => void;
  /** Moves by `delta` blocks (keeps playing or paused). */
  skip: (delta: number) => void;
  setRate: (rate: number) => void;
  setVoice: (voice: string | null) => void;
}

interface Place {
  block: number;
  chunk: number;
}

const PREFS_KEY = 'read-aloud';
const DEFAULT_PREFS: ReadAloudPrefs = { rate: 1, voice: null };

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance === 'function'
    ? window.speechSynthesis
    : null;
}

function reveal(el: HTMLElement): void {
  if (typeof el.scrollIntoView !== 'function') return;
  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}

/** `key` changes (the open article) stop reading. */
export function useReadAloud(key: string | null): ReadAloud {
  const [prefs, setPrefs] = useStored<ReadAloudPrefs>(PREFS_KEY, DEFAULT_PREFS);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth()?.getVoices() ?? []);
  const [status, setStatus] = useState<ReadAloudStatus>('idle');
  const [pos, setPos] = useState<Place | null>(null);

  const body = useRef<HTMLElement | null>(null);
  const blocks = useRef<SpeechBlock[]>([]);
  const lit = useRef<HTMLElement | null>(null);
  // Each utterance carries the generation it was spoken in; events from an
  // older one (cancelled) are ignored.
  const gen = useRef(0);
  const [count, setCount] = useState(0);
  const live = useRef({ status, pos, prefs, voices });
  useEffect(() => {
    live.current = { status, pos, prefs, voices };
  });

  useEffect(() => {
    const s = synth();
    if (!s) return;
    const on = (): void => setVoices(s.getVoices());
    on();
    s.addEventListener('voiceschanged', on);
    return () => s.removeEventListener('voiceschanged', on);
  }, []);

  const highlight = useCallback((i: number | null): void => {
    lit.current?.classList.remove('speaking');
    lit.current = i === null ? null : (blocks.current[i]?.el ?? null);
    if (lit.current) {
      lit.current.classList.add('speaking');
      reveal(lit.current);
    }
  }, []);

  /** Sets status and place now (for the callbacks) and for the next render. */
  const settle = useCallback(
    (lightAt: number | null | undefined, st: ReadAloudStatus, p: Place | null): void => {
      if (lightAt !== undefined) highlight(lightAt);
      setStatus(st);
      setPos(p);
      live.current = { ...live.current, status: st, pos: p };
    },
    [highlight],
  );

  const halt = useCallback((): void => {
    gen.current++;
    synth()?.cancel();
  }, []);

  // The utterance's end speaks the next chunk through a ref (no self-reference).
  const again = useRef<(block: number, chunk: number) => void>(() => undefined);
  const speak = useCallback(
    (block: number, chunk: number): void => {
      const s = synth();
      const b = blocks.current[block];
      if (!s || !b) {
        halt();
        settle(null, 'idle', null);
        return;
      }
      halt();
      const mine = gen.current;
      const u = new SpeechSynthesisUtterance(b.chunks[chunk] ?? '');
      const { prefs: p, voices: vs } = live.current;
      const voice = p.voice ? vs.find((v) => v.voiceURI === p.voice) : undefined;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = p.rate;
      u.onend = () => {
        if (mine !== gen.current) return;
        if (chunk + 1 < b.chunks.length) again.current(block, chunk + 1);
        else again.current(block + 1, 0);
      };
      u.onerror = (e) => {
        if (mine !== gen.current || e.error === 'interrupted' || e.error === 'canceled') return;
        console.warn('read aloud:', e.error);
        settle(null, 'idle', null);
      };
      settle(lit.current === b.el ? undefined : block, 'playing', { block, chunk });
      s.speak(u);
    },
    [halt, settle],
  );

  useEffect(() => {
    again.current = speak;
  }, [speak]);

  const stop = useCallback((): void => {
    halt();
    settle(null, 'idle', null);
  }, [halt, settle]);

  const start = useCallback((): void => {
    if (!body.current) return;
    blocks.current = speechBlocks(body.current);
    setCount(blocks.current.length);
    const sel = window.getSelection();
    const from =
      sel && !sel.isCollapsed && sel.anchorNode && body.current.contains(sel.anchorNode)
        ? blockAt(blocks.current, sel.anchorNode)
        : 0;
    speak(Math.max(0, from), 0);
  }, [speak]);

  const toggle = useCallback((): void => {
    const { status: st, pos: p } = live.current;
    if (st === 'playing') {
      halt();
      settle(undefined, 'paused', p);
    } else if (st === 'paused' && p) speak(p.block, p.chunk);
    else start();
  }, [halt, settle, speak, start]);

  const skip = useCallback(
    (delta: number): void => {
      const { status: st, pos: p } = live.current;
      if (st === 'idle' || !p) return;
      const block = Math.min(Math.max(0, p.block + delta), blocks.current.length - 1);
      if (st === 'playing') speak(block, 0);
      else settle(block, 'paused', { block, chunk: 0 });
    },
    [speak, settle],
  );

  // A new speed or voice applies from the current chunk.
  const restart = useCallback((): void => {
    const { status: st, pos: p } = live.current;
    if (st === 'playing' && p) speak(p.block, p.chunk);
  }, [speak]);

  const setPref = (next: ReadAloudPrefs): void => {
    setPrefs(next);
    live.current = { ...live.current, prefs: next };
    restart();
  };
  const setRate = (rate: number): void => setPref({ ...prefs, rate });
  const setVoice = (voice: string | null): void => setPref({ ...prefs, voice });

  const attach = useCallback(
    (el: HTMLElement | null): void => {
      body.current = el;
      if (live.current.status === 'idle' || !el) return;
      // The body was rendered again (images loaded, the file changed): find
      // the blocks again and keep the place.
      blocks.current = speechBlocks(el);
      setCount(blocks.current.length);
      const p = live.current.pos;
      if (!p || p.block >= blocks.current.length) {
        stop();
        return;
      }
      lit.current = null;
      highlight(p.block);
    },
    [highlight, stop],
  );

  // Another article, or leaving the page: stop.
  useEffect(() => stop, [key, stop]);

  return {
    available: !!synth() && voices.length > 0,
    status,
    at: pos && status !== 'idle' ? { block: pos.block, of: count } : null,
    voices,
    prefs,
    attach,
    start,
    toggle,
    stop,
    skip,
    setRate,
    setVoice,
  };
}
