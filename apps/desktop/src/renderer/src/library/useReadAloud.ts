/**
 * Read aloud (T37, T38, SPEC §15.6, D-58, D-59): the reader's text spoken by
 * Kokoro, an open-source neural voice that runs on this computer. Main turns
 * each chunk (`speech.ts`) into audio (`tts:speak`); this plays it with Web
 * Audio and, like a video player, keeps a buffer: while a chunk plays, the
 * next `AHEAD` are made one after another (one request at a time, so a skip
 * waits behind at most one chunk), and the start of this paragraph and the
 * one before are kept, so skipping back is instant too (T41). Pause
 * suspends the audio where it is; the buffer keeps filling while paused.
 * The block being read gets the `speaking` class and is kept in view.
 *
 * The voice model is downloaded once, when the learner first starts reading
 * and agrees (`offer` → `download`). Voice and speed are UI preferences of
 * this computer, kept in `localStorage`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_VOICE,
  SAMPLE_RATE,
  VOICE_IDS,
  type DownloadProgress,
  type TtsStatus,
  type VoiceId,
} from '../../../shared/tts';
import { invoke, stream, type Stream } from '../ipc';
import { errorText, useApp } from '../lib/app-context';
import { useStored } from '../lib/hooks';
import { blockAt, speechBlocks, type SpeechBlock } from './speech';

/** `loading`: waiting for the chunk's audio (the first one also starts the engine). */
export type ReadAloudStatus = 'idle' | 'loading' | 'playing' | 'paused';

export interface ReadAloudPrefs {
  rate: number;
  voice: VoiceId;
}

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** How many chunks after the one playing are made ahead of time. */
export const AHEAD = 3;

export interface ReadAloud {
  /** The voice model is downloaded (null until known). */
  installed: boolean | null;
  /** Size, download state and, once started, where the engine runs. */
  info: TtsStatus | null;
  status: ReadAloudStatus;
  /** The block being read (0-based) and how many there are; null when idle. */
  at: { block: number; of: number } | null;
  prefs: ReadAloudPrefs;
  /** Start was asked for before the model was downloaded: show the offer. */
  offer: boolean;
  /** While downloading: bytes so far. */
  downloading: DownloadProgress | null;
  download: () => void;
  /** Closes the offer; stops a download in progress. */
  dismiss: () => void;
  /** The reader's body, after each render of it (the blocks are found again). */
  attach: (body: HTMLElement | null) => void;
  /** Starts from the selection's paragraph if there is one, else from the top. */
  start: () => void;
  toggle: () => void;
  stop: () => void;
  /** Moves by `delta` blocks (keeps playing or paused). */
  skip: (delta: number) => void;
  setRate: (rate: number) => void;
  setVoice: (voice: VoiceId) => void;
}

interface Place {
  block: number;
  chunk: number;
}

const PREFS_KEY = 'read-aloud';
const DEFAULT_PREFS: ReadAloudPrefs = { rate: 1, voice: DEFAULT_VOICE };

/** Stored prefs from T37 named a system voice; anything not a Kokoro voice is the default. */
function cleanPrefs(p: Partial<ReadAloudPrefs> | null): ReadAloudPrefs {
  const voice = (VOICE_IDS as readonly string[]).includes(p?.voice ?? '')
    ? (p?.voice as VoiceId)
    : DEFAULT_VOICE;
  const rate = RATES.includes(p?.rate as (typeof RATES)[number]) ? (p?.rate as number) : 1;
  return { voice, rate };
}

function reveal(el: HTMLElement): void {
  if (typeof el.scrollIntoView !== 'function') return;
  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}

const placeKey = (p: Place, prefs: ReadAloudPrefs): string =>
  `${p.block}:${p.chunk}:${prefs.voice}:${prefs.rate}`;

/** The chunk after `p`, or null at the end. */
function following(blocks: SpeechBlock[], p: Place): Place | null {
  const b = blocks[p.block];
  if (!b) return null;
  if (p.chunk + 1 < b.chunks.length) return { block: p.block, chunk: p.chunk + 1 };
  return p.block + 1 < blocks.length ? { block: p.block + 1, chunk: 0 } : null;
}

/** The `n` chunks after `p`, in order (fewer near the end). */
function ahead(blocks: SpeechBlock[], p: Place, n: number): Place[] {
  const out: Place[] = [];
  let at: Place | null = p;
  while (out.length < n && (at = following(blocks, at))) out.push(at);
  return out;
}

/**
 * The places whose audio is kept while `p` plays: it, the `AHEAD` after it,
 * and the starts of its paragraph and the one before (where the skip
 * buttons go).
 */
function kept(blocks: SpeechBlock[], p: Place): Place[] {
  const back = [{ block: p.block, chunk: 0 }];
  if (p.block > 0) back.push({ block: p.block - 1, chunk: 0 });
  return [p, ...ahead(blocks, p, AHEAD), ...back];
}

/** `key` changes (the open article) stop reading. */
export function useReadAloud(key: string | null): ReadAloud {
  const app = useApp();
  const [stored, setStored] = useStored<ReadAloudPrefs>(PREFS_KEY, DEFAULT_PREFS);
  const prefs = cleanPrefs(stored);
  const [info, setInfo] = useState<TtsStatus | null>(null);
  const [status, setStatus] = useState<ReadAloudStatus>('idle');
  const [pos, setPos] = useState<Place | null>(null);
  const [offer, setOffer] = useState(false);
  const [downloading, setDownloading] = useState<DownloadProgress | null>(null);

  const body = useRef<HTMLElement | null>(null);
  const blocks = useRef<SpeechBlock[]>([]);
  const lit = useRef<HTMLElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  // Audio by place (and voice and speed): the places in `kept`.
  const cache = useRef(new Map<string, Promise<AudioBuffer>>());
  const dl = useRef<Stream<unknown> | null>(null);
  // Each chunk played carries the generation it started in; an older one's
  // end (stopped, skipped) is ignored.
  const gen = useRef(0);
  const engineSeen = useRef(false);
  const [count, setCount] = useState(0);
  const live = useRef({ status, pos, prefs });
  useEffect(() => {
    live.current = { status, pos, prefs };
  });

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setInfo(await invoke('tts:status'));
    } catch {
      /* shown as not installed; start offers the download */
    }
  }, []);
  useEffect(() => {
    let on = true;
    void invoke('tts:status').then(
      (s) => on && setInfo(s),
      () => undefined,
    );
    return () => {
      on = false;
    };
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

  /** Stops the sound and forgets the chunk playing. */
  const halt = useCallback((): void => {
    gen.current++;
    const s = source.current;
    source.current = null;
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* not started yet */
      }
    }
  }, []);

  const audioFor = useCallback((p: Place, pr: ReadAloudPrefs): Promise<AudioBuffer> | null => {
    const text = blocks.current[p.block]?.chunks[p.chunk];
    const c = ctx.current;
    if (!text || !c) return null;
    const k = placeKey(p, pr);
    let a = cache.current.get(k);
    if (!a) {
      a = invoke('tts:speak', { text, voice: pr.voice, speed: pr.rate }).then(({ audio }) => {
        const buf = c.createBuffer(1, Math.max(1, audio.length), SAMPLE_RATE);
        buf.getChannelData(0).set(audio);
        return buf;
      });
      // A failure is reported by whoever plays it; a prefetch is retried then.
      a.catch(() => cache.current.delete(k));
      cache.current.set(k, a);
    }
    return a;
  }, []);

  /**
   * Makes the chunks after `p` in order, one at a time, until `AHEAD` are
   * ready; stops when generation `mine` ends (the next chunk plays, a skip,
   * stop), as the next chunk's own fill takes over from where this got to.
   */
  const fill = useCallback(
    async (p: Place, pr: ReadAloudPrefs, mine: number): Promise<void> => {
      for (const at of ahead(blocks.current, p, AHEAD)) {
        if (mine !== gen.current) return;
        const a = audioFor(at, pr);
        if (!a) return;
        try {
          await a;
        } catch {
          return; // Reported when it is played.
        }
      }
    },
    [audioFor],
  );

  // The chunk's end plays the next through a ref (no self-reference).
  const again = useRef<(p: Place) => void>(() => undefined);
  const play = useCallback(
    (p: Place): void => {
      const b = blocks.current[p.block];
      const c = ctx.current;
      halt();
      if (!b || !c) {
        cache.current.clear();
        settle(null, 'idle', null);
        return;
      }
      const mine = gen.current;
      const pr = live.current.prefs;
      settle(lit.current === b.el ? undefined : p.block, 'loading', p);
      // Keep only the buffer around this chunk.
      const keep = new Set(kept(blocks.current, p).map((w) => placeKey(w, pr)));
      for (const k of cache.current.keys()) if (!keep.has(k)) cache.current.delete(k);
      const audio = audioFor(p, pr);
      if (!audio) return;
      audio.then(
        (buf) => {
          if (mine !== gen.current) return;
          const s = c.createBufferSource();
          s.buffer = buf;
          s.connect(c.destination);
          s.onended = () => {
            if (mine !== gen.current) return;
            const n = following(blocks.current, p);
            if (n) again.current(n);
            else {
              halt();
              cache.current.clear();
              settle(null, 'idle', null);
            }
          };
          source.current = s;
          s.start();
          if (live.current.status === 'loading') settle(undefined, 'playing', p);
          // While this plays, the buffer fills.
          void fill(p, pr, mine);
          // The first chunk started the engine: learn where it runs.
          if (!engineSeen.current) {
            engineSeen.current = true;
            void refresh();
          }
        },
        (err: unknown) => {
          if (mine !== gen.current) return;
          halt();
          cache.current.clear();
          settle(null, 'idle', null);
          app.notify(errorText(err), 'error');
          void refresh();
        },
      );
    },
    [halt, settle, audioFor, fill, app, refresh],
  );

  useEffect(() => {
    again.current = play;
  }, [play]);

  const stop = useCallback((): void => {
    halt();
    cache.current.clear();
    settle(null, 'idle', null);
  }, [halt, settle]);

  const begin = useCallback((): void => {
    if (!body.current) return;
    blocks.current = speechBlocks(body.current);
    setCount(blocks.current.length);
    if (blocks.current.length === 0) return;
    ctx.current ??= new AudioContext();
    void ctx.current.resume();
    const sel = window.getSelection();
    const from =
      sel && !sel.isCollapsed && sel.anchorNode && body.current.contains(sel.anchorNode)
        ? blockAt(blocks.current, sel.anchorNode)
        : 0;
    play({ block: Math.max(0, from), chunk: 0 });
  }, [play]);

  const start = useCallback((): void => {
    if (info?.installed) begin();
    else setOffer(true);
  }, [info?.installed, begin]);

  const toggle = useCallback((): void => {
    const { status: st, pos: p } = live.current;
    const c = ctx.current;
    if ((st === 'playing' || st === 'loading') && p) {
      void c?.suspend();
      settle(undefined, 'paused', p);
    } else if (st === 'paused' && p) {
      void c?.resume();
      // Skipped (or the voice changed) while paused: nothing is waiting to resume.
      if (source.current) settle(undefined, 'playing', p);
      else play(p);
    } else start();
  }, [settle, play, start]);

  const skip = useCallback(
    (delta: number): void => {
      const { status: st, pos: p } = live.current;
      if (st === 'idle' || !p) return;
      const block = Math.min(Math.max(0, p.block + delta), blocks.current.length - 1);
      if (st === 'paused') {
        halt();
        settle(block, 'paused', { block, chunk: 0 });
      } else play({ block, chunk: 0 });
    },
    [halt, play, settle],
  );

  // A new speed or voice applies from the start of the current chunk.
  const setPref = (next: ReadAloudPrefs): void => {
    setStored(next);
    live.current = { ...live.current, prefs: next };
    cache.current.clear();
    const { status: st, pos: p } = live.current;
    if (!p) return;
    if (st === 'paused') halt();
    else if (st !== 'idle') play(p);
  };
  const setRate = (rate: number): void => setPref({ ...prefs, rate });
  const setVoice = (voice: VoiceId): void => setPref({ ...prefs, voice });

  const download = useCallback((): void => {
    if (dl.current) return;
    setDownloading({ received: 0, total: info?.bytes ?? 0 });
    const s = stream('tts:download', undefined, (p) => setDownloading(p));
    dl.current = s;
    s.result.then(
      async (r) => {
        if (dl.current !== s) return;
        dl.current = null;
        setDownloading(null);
        await refresh();
        if (r.installed) {
          setOffer(false);
          begin();
        }
      },
      (err: unknown) => {
        if (dl.current !== s) return;
        dl.current = null;
        setDownloading(null);
        app.notify(errorText(err), 'error');
        void refresh();
      },
    );
  }, [info?.bytes, refresh, begin, app]);

  const dismiss = useCallback((): void => {
    const s = dl.current;
    dl.current = null;
    s?.cancel();
    setDownloading(null);
    setOffer(false);
  }, []);

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
  // Leaving the page: stop a download and let the audio device go.
  useEffect(
    () => () => {
      dl.current?.cancel();
      dl.current = null;
      void ctx.current?.close();
      ctx.current = null;
    },
    [],
  );

  return {
    installed: info ? info.installed : null,
    info,
    status,
    at: pos && status !== 'idle' ? { block: pos.block, of: count } : null,
    prefs,
    offer,
    downloading,
    download,
    dismiss,
    attach,
    start,
    toggle,
    stop,
    skip,
    setRate,
    setVoice,
  };
}
