/**
 * Read aloud with Kokoro (T38, SPEC §15.6, D-59): the voices, and the IPC
 * shapes for the model download and for speaking one chunk. Shared by main
 * and renderer; imports nothing but zod.
 */
import { z } from 'zod';

/**
 * Kokoro v1.0's English voices: `a` American, `b` British; `f`/`m` female,
 * male. Grades are the model card's (A best); the list is in grade order
 * within each accent, and the first is the default.
 */
export const VOICES = [
  { id: 'af_heart', name: 'Heart', accent: 'US', gender: 'female', grade: 'A' },
  { id: 'af_bella', name: 'Bella', accent: 'US', gender: 'female', grade: 'A-' },
  { id: 'af_nicole', name: 'Nicole', accent: 'US', gender: 'female', grade: 'B-' },
  { id: 'af_aoede', name: 'Aoede', accent: 'US', gender: 'female', grade: 'C+' },
  { id: 'af_kore', name: 'Kore', accent: 'US', gender: 'female', grade: 'C+' },
  { id: 'af_sarah', name: 'Sarah', accent: 'US', gender: 'female', grade: 'C+' },
  { id: 'af_alloy', name: 'Alloy', accent: 'US', gender: 'female', grade: 'C' },
  { id: 'af_nova', name: 'Nova', accent: 'US', gender: 'female', grade: 'C' },
  { id: 'af_sky', name: 'Sky', accent: 'US', gender: 'female', grade: 'C-' },
  { id: 'af_jessica', name: 'Jessica', accent: 'US', gender: 'female', grade: 'D' },
  { id: 'af_river', name: 'River', accent: 'US', gender: 'female', grade: 'D' },
  { id: 'am_fenrir', name: 'Fenrir', accent: 'US', gender: 'male', grade: 'C+' },
  { id: 'am_michael', name: 'Michael', accent: 'US', gender: 'male', grade: 'C+' },
  { id: 'am_puck', name: 'Puck', accent: 'US', gender: 'male', grade: 'C+' },
  { id: 'am_echo', name: 'Echo', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_eric', name: 'Eric', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_liam', name: 'Liam', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_onyx', name: 'Onyx', accent: 'US', gender: 'male', grade: 'D' },
  { id: 'am_santa', name: 'Santa', accent: 'US', gender: 'male', grade: 'D-' },
  { id: 'am_adam', name: 'Adam', accent: 'US', gender: 'male', grade: 'F+' },
  { id: 'bf_emma', name: 'Emma', accent: 'UK', gender: 'female', grade: 'B-' },
  { id: 'bf_isabella', name: 'Isabella', accent: 'UK', gender: 'female', grade: 'C' },
  { id: 'bf_alice', name: 'Alice', accent: 'UK', gender: 'female', grade: 'D' },
  { id: 'bf_lily', name: 'Lily', accent: 'UK', gender: 'female', grade: 'D' },
  { id: 'bm_fable', name: 'Fable', accent: 'UK', gender: 'male', grade: 'C' },
  { id: 'bm_george', name: 'George', accent: 'UK', gender: 'male', grade: 'C' },
  { id: 'bm_lewis', name: 'Lewis', accent: 'UK', gender: 'male', grade: 'D+' },
  { id: 'bm_daniel', name: 'Daniel', accent: 'UK', gender: 'male', grade: 'D' },
] as const;

export type VoiceId = (typeof VOICES)[number]['id'];
export const VOICE_IDS = VOICES.map((v) => v.id) as [VoiceId, ...VoiceId[]];
export const DEFAULT_VOICE: VoiceId = 'af_heart';
export const voiceId = z.enum(VOICE_IDS);

/** Kokoro's output: mono, 24 kHz. */
export const SAMPLE_RATE = 24_000;
/** The longest text one `tts:speak` takes (the reader sends chunks of at most 240). */
export const MAX_SPEAK_CHARS = 1000;

/** Where the engine runs: the CPU unless Settings → Library turns on the GPU (D-60). */
export const ttsDevice = z.enum(['gpu', 'cpu']);
export type TtsDevice = z.infer<typeof ttsDevice>;

export const ttsStatus = z.strictObject({
  /** The model and voices are downloaded and checked. */
  installed: z.boolean(),
  /** What a download fetches (or what is on disk, when installed). */
  bytes: z.int().min(0),
  /** A download is under way (in any window). */
  downloading: z.boolean(),
  /**
   * Once the engine has started: where it runs, how many times faster than
   * real time (0 until a chunk is spoken), and whether the GPU was asked for
   * but could not be used.
   */
  engine: z
    .strictObject({
      device: ttsDevice,
      speed: z.number().min(0),
      gpu: z.string().nullable(),
      fellBack: z.boolean(),
    })
    .nullable(),
});
export type TtsStatus = z.infer<typeof ttsStatus>;

export const downloadProgress = z.strictObject({
  received: z.int().min(0),
  total: z.int().min(0),
});
export type DownloadProgress = z.infer<typeof downloadProgress>;

export const downloadResult = z.strictObject({
  installed: z.boolean(),
  cancelled: z.boolean(),
});

export const speakRequest = z.strictObject({
  text: z.string().min(1).max(MAX_SPEAK_CHARS),
  voice: voiceId,
  speed: z.number().min(0.5).max(2),
});
export type SpeakRequest = z.input<typeof speakRequest>;

export const speakResponse = z.strictObject({
  /** Mono samples at `SAMPLE_RATE`. */
  audio: z.instanceof(Float32Array),
});
