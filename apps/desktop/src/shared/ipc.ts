/**
 * The IPC contract between the UI renderer and the main process (SPEC §3,
 * §10). Every channel is listed here with zod schemas; the main process
 * validates each request (and its own responses and stream events) against
 * them, and the renderer's types come from them.
 *
 * Two kinds of channel:
 * - invoke: one request, one response.
 * - stream: one request, any number of events, then one result. The
 *   renderer can cancel; the handler sees an `AbortSignal`.
 *
 * Replies cross the bridge as an `IpcResult` envelope, never as a thrown
 * error, so the renderer always gets a code it can act on.
 *
 * Shared by main and renderer (types); imports nothing but zod. The preload
 * imports only `channels.ts` and types from here.
 */
import { z } from 'zod';
import { INVOKE_CHANNELS, STREAM_CHANNELS } from './channels';
import * as P from './practice';
import * as S from './settings';
import * as T from './tutor';
import * as I from './intake';
import * as U from './updates';
import * as L from './library';

export {
  INVOKE_CHANNELS,
  STREAM_CHANNELS,
  STREAM_START,
  STREAM_EVENT,
  STREAM_CANCEL,
  isInvokeChannel,
  isStreamChannel,
} from './channels';

export const invokeChannels = {
  /** App and runtime versions (the example channel from T02). */
  'app:version': {
    request: z.undefined(),
    response: z.strictObject({
      app: z.string(),
      electron: z.string(),
      chrome: z.string(),
      node: z.string(),
    }),
  },

  // ---- practice (T08): progress, problems, workspace files, runs, attempts
  /** Topics in teaching order, with the learner's level in each. */
  'catalog:topics': {
    request: z.undefined(),
    response: z.strictObject({ topics: z.array(P.topicView) }),
  },
  'profile:get': { request: z.undefined(), response: P.profileResponse },
  /** Save the default profile (onboarding's "use defaults"; T09 adds the questions). */
  'profile:defaults': { request: z.undefined(), response: P.profileResponse },
  'status:get': { request: z.undefined(), response: P.statusResponse },
  'problems:list': {
    request: P.problemFilters,
    response: z.strictObject({ problems: z.array(P.problemListItem) }),
  },
  'problems:get': { request: P.slugRequest, response: P.problemDetail },
  /** Recommend the next problem (SPEC §9.2); may move the focus topic. */
  'problems:next': { request: P.nextRequest, response: P.nextResponse },
  /** Open (or resume) an attempt and create the starter file. */
  'problems:start': { request: P.slugRequest, response: P.startResponse },
  /** The problem's languages and whether each can run here (cargo / go found). */
  'problems:languages': {
    request: P.slugRequest,
    response: z.strictObject({ languages: z.array(P.languageOption) }),
  },
  /**
   * Work the problem in another language: switches (or opens) the attempt and
   * creates that language's solution file. Refused (`busy`) while tests run.
   */
  'problems:language': { request: P.languageRequest, response: P.workspaceResponse },
  /** Refused (`locked`) until an attempt on the problem is recorded. */
  'problems:reference': { request: P.slugRequest, response: P.referenceResponse },
  'workspace:get': { request: P.slugRequest, response: P.workspaceResponse },
  /** Save as you type. Refused (`busy`) while the problem's tests run. */
  'workspace:save': { request: P.saveRequest, response: P.saveResponse },
  /** Visible tests only; stored as a `run` when an attempt is open. */
  'runs:run': { request: P.slugRequest, response: P.reportView },
  /** Every test; records the attempt only when all pass. */
  'runs:submit': { request: P.slugRequest, response: P.submitResponse },
  /** Runs every test once more and records the attempt as gave up. */
  'attempts:give-up': { request: P.giveUpRequest, response: P.giveUpResponse },
  /** Recorded attempts, oldest first. */
  'attempts:list': {
    request: P.attemptsRequest,
    response: z.strictObject({ attempts: z.array(P.attemptView) }),
  },

  // ---- settings and onboarding (T09)
  /** Save the questionnaire's answers (onboarding and Settings → Profile). */
  'profile:set': { request: S.profileUpdate, response: P.profileResponse },
  'settings:get': { request: z.undefined(), response: S.settingsResponse },
  /** Apply a change at once (no restart). Refused (`invalid`) if any value is invalid. */
  'settings:set': { request: S.settingsPatch, response: S.settingsResponse },
  /** Where the API key comes from and its last four characters; never the key. */
  'secrets:status': { request: z.undefined(), response: S.keyStatus },
  /** Store the API key in the OS keychain. Refused: `invalid_key`, `unavailable`. */
  'secrets:set-key': { request: S.setKeyRequest, response: S.keyStatus },
  'secrets:clear-key': { request: z.undefined(), response: S.keyStatus },
  /** One small API call with the key in use (no tokens spent): is the key and model good? */
  'tutor:test': { request: z.undefined(), response: S.testResult },
  /** The Python executor (Pyodide) and its versions. */
  'exec:status': { request: z.undefined(), response: S.execStatus },
  /** Rust/Go: local toolchains, Podman and Docker as detected now, the runner image (T18). */
  'exec:runtimes': { request: S.runtimesRequest, response: S.runtimesView },
  /** Test sandbox: hello world in Rust and Go inside the runtime's container. */
  'exec:test': { request: S.runtimeRequest, response: S.sandboxResult },
  /** Opens the README section on installing a runtime or the toolchains. */
  'exec:install-help': {
    request: S.installHelpRequest,
    response: z.strictObject({ opened: z.boolean() }),
  },
  'data:info': { request: z.undefined(), response: S.dataInfo },
  'data:open-folder': { request: z.undefined(), response: z.strictObject({ opened: z.boolean() }) },
  /** Asks where to save, then writes the export zip; `path: null` if cancelled. */
  'data:export': { request: z.undefined(), response: S.exportResponse },
  /** Asks for a zip, validates it, exports the current data to backups, restarts to apply. */
  'data:import': { request: z.undefined(), response: S.importResponse },
  /** Confirms, exports to backups, then resets (everything: on restart). */
  'data:reset': { request: S.resetRequest, response: S.resetResponse },

  // ---- tutor (T10): status, chat threads, explanation pages
  /** Which backend is in use and whether it can run. */
  'tutor:status': { request: z.undefined(), response: T.tutorStatus },
  /** Claude Code's path, version and whether it can be used; `recheck` looks again (T11). */
  'tutor:claude-code': { request: T.claudeCodeRequest, response: T.claudeCodeInfo },
  /** A thread's current transcript. */
  'chat:thread': { request: T.threadRequest, response: T.threadResponse },
  /** Archive the thread ("Reset chat"). Refused (`busy`) while a reply streams. */
  'chat:reset': { request: T.threadRequest, response: T.resetResponse },
  /** A problem's explanation versions, newest first. */
  'explanations:list': { request: P.slugRequest, response: T.explanationsResponse },
  /** One version's HTML (the latest without `version`); shown only in a sandboxed iframe. */
  'explanations:page': { request: T.pageRequest, response: T.pageResponse },
  /** The learner opened an explanation: an open attempt counts as explained. */
  'explanations:viewed': { request: P.slugRequest, response: T.viewedResponse },

  // ---- new problems (T12): intake jobs and open sets
  /**
   * Start writing a new problem (generate, paste or import). Refused:
   * `invalid`, `busy` (one job at a time), `unavailable` (no tutor),
   * `unknown_set`, `unknown_entry`.
   */
  'intake:start': { request: I.intakeRequest, response: I.startResponse },
  /** The job still running, if any (the dialog reattaches to it). */
  'intake:current': { request: z.undefined(), response: I.currentResponse },
  /** Stop a running job; it ends with `cancelled`. */
  'intake:cancel': { request: I.jobRequest, response: I.cancelResponse },
  /** The open problem sets that can be imported (no network). */
  'open-sets:list': { request: z.undefined(), response: I.openSetsResponse },
  /** A set's entries (no network), each with the slug it was imported as, if any. */
  'open-sets:entries': { request: I.entriesRequest, response: I.entriesResponse },

  // ---- library (T21): folders and the article index; ids and names, never paths
  /** The chosen folders with article counts. */
  'library:folders': { request: z.undefined(), response: L.foldersResponse },
  /** Asks for a folder with the OS picker, adds it and scans it. Refused: `duplicate`, `too_many`, `unavailable`. */
  'library:add-folder': { request: z.undefined(), response: L.addFolderResponse },
  /** Removes a folder from the library (its index rows; never its files). Confirmed in the UI. */
  'library:remove-folder': { request: L.folderRequest, response: L.foldersResponse },
  /** Opens the folder in the file manager. */
  'library:open-folder': {
    request: L.folderRequest,
    response: z.strictObject({ opened: z.boolean() }),
  },
  /** The folder tree with articles, as last scanned. */
  'library:tree': { request: z.undefined(), response: L.treeResponse },
  /** Rescans now (Refresh), then the tree. */
  'library:refresh': { request: z.undefined(), response: L.treeResponse },
  /**
   * Opens an article in the reader (T22): its header, body, and per image
   * reference an asset URL (random token, never a path) or why it is not
   * shown. Reads the file only; no network. Refused: `not_found`.
   */
  'library:article': { request: L.folderRequest, response: L.articleResponse },
  /**
   * Linked images of an article (T23, §15.4): main finds the references in
   * the file itself and downloads them (unless `ask` mode without `force`).
   * Refused: `not_found`.
   */
  'library:load-images': { request: L.loadImagesRequest, response: L.loadImagesResponse },
  /** The linked-image cache's size (Settings → Library). */
  'library:image-cache': { request: z.undefined(), response: L.imageCacheResponse },
  /** Clears the linked-image cache; then its size. */
  'library:clear-image-cache': { request: z.undefined(), response: L.imageCacheResponse },
  /** Opens an article's link in the system browser: `https:`, `http:`, `mailto:` only. Refused: `scheme`. */
  'library:open-link': {
    request: L.openLinkRequest,
    response: z.strictObject({ opened: z.boolean() }),
  },

  // ---- updates (T13)
  /** Where the updater is (`unsupported` in development builds). */
  'updates:status': { request: z.undefined(), response: U.updateState },
  /** "Check now"; returns at once with `checking` (follow `updates:watch`). */
  'updates:check': { request: z.undefined(), response: U.updateState },
  /** Download the update found, when automatic updates are off. */
  'updates:download': { request: z.undefined(), response: U.updateState },
  /** "Restart to update": quits, installs and starts again; false if nothing is downloaded. */
  'updates:restart': { request: z.undefined(), response: U.restartResponse },
} as const;

export const streamChannels = {
  /**
   * Example stream: counts from 1 to `to`, one event every `intervalMs`.
   * Exists to exercise streaming and cancel until chat and job progress
   * (T08, T10) use the same mechanism.
   */
  'example:count': {
    request: z.strictObject({
      to: z.int().min(1).max(1000),
      intervalMs: z.int().min(0).max(10_000),
    }),
    event: z.strictObject({ n: z.int() }),
    result: z.strictObject({ counted: z.int() }),
  },
  /**
   * Edits to a problem's solution file made outside the app (another
   * editor): one event per change, until the renderer cancels.
   */
  'workspace:watch': {
    request: P.slugRequest,
    event: P.watchEvent,
    result: P.watchResult,
  },
  /**
   * One chat turn: the tutor's events (text, tool chips, UI events), ending
   * with `done` or `error`; the result is the stored reply. Cancel stops the
   * turn. Refused before it starts: `busy`, `unavailable`, `empty`…
   */
  'chat:send': { request: T.sendRequest, event: T.chatEvent, result: T.sendResult },
  /**
   * A job's progress, replayed from its first event, until it ends; the
   * result is how it ended. Cancel stops following, not the job (that is
   * `intake:cancel`). Refused: `not_found`.
   */
  'intake:events': { request: I.jobRequest, event: I.intakeEvent, result: I.intakeOutcome },
  /** The updater's state: the current one first, then every change, until cancelled. */
  'updates:watch': {
    request: z.undefined(),
    event: U.updateState,
    result: z.strictObject({ closed: z.literal(true) }),
  },
  /**
   * While the Library page is open: rescans now and on file changes
   * (debounced), sending the tree after each scan, until cancelled.
   */
  'library:watch': {
    request: z.undefined(),
    event: L.treeResponse,
    result: z.strictObject({ closed: z.literal(true) }),
  },
  /**
   * "Make available offline" (T23): downloads every article's linked images
   * in a folder, in the background; progress per article. Cancel stops it.
   * Refused: `not_found`.
   */
  'library:offline': {
    request: L.folderRequest,
    event: L.offlineProgress,
    result: L.offlineResult,
  },
  /** Pull / Update the runner image in a runtime (T18): its output lines, then the outcome. */
  'exec:pull': { request: S.runtimeRequest, event: S.pullEvent, result: S.pullResult },
} as const;

export type InvokeChannel = keyof typeof invokeChannels;
export type StreamChannel = keyof typeof streamChannels;

export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof invokeChannels)[C]['request']>;
export type InvokeResponse<C extends InvokeChannel> = z.output<
  (typeof invokeChannels)[C]['response']
>;
export type StreamRequest<C extends StreamChannel> = z.input<(typeof streamChannels)[C]['request']>;
export type StreamEvent<C extends StreamChannel> = z.output<(typeof streamChannels)[C]['event']>;
export type StreamResult<C extends StreamChannel> = z.output<(typeof streamChannels)[C]['result']>;

// The preload's name lists (`channels.ts`) must match the contract exactly.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const namesMatch: [
  Same<(typeof INVOKE_CHANNELS)[number], InvokeChannel>,
  Same<(typeof STREAM_CHANNELS)[number], StreamChannel>,
] = [true, true];
void namesMatch;

export const streamStart = z.strictObject({
  id: z.string().min(1).max(64),
  channel: z.string(),
  request: z.unknown(),
});
export type StreamStart = z.infer<typeof streamStart>;
/**
 * What main sends on `STREAM_EVENT`: one message per event, then one with the
 * result. The result travels in order with the events because the invoke
 * reply to `STREAM_START` (a different pipe) can overtake them; the preload
 * resolves a stream from this message, so no event is lost.
 */
export type StreamEventMessage =
  { id: string; event: unknown } | { id: string; result: IpcResult<unknown> };

export type IpcErrorCode =
  | 'invalid_request' // the payload failed its schema
  | 'unknown_channel'
  | 'forbidden' // the sender is not the app's own page
  | 'cancelled'
  | 'refused' // the handler declined on purpose; `reason` says why (e.g. `busy`, `locked`)
  | 'internal'; // the handler threw, or its reply failed its schema

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: IpcErrorCode; message: string; reason?: string } };

/** What a running stream gives the renderer. */
export interface StreamHandle<R> {
  readonly result: Promise<IpcResult<R>>;
  cancel(): void;
}

/** The `window.tutor` bridge exposed by the preload. */
export interface TutorBridge {
  invoke<C extends InvokeChannel>(
    channel: C,
    request: InvokeRequest<C>,
  ): Promise<IpcResult<InvokeResponse<C>>>;
  stream<C extends StreamChannel>(
    channel: C,
    request: StreamRequest<C>,
    onEvent: (event: StreamEvent<C>) => void,
  ): StreamHandle<StreamResult<C>>;
}
