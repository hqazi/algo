/**
 * Handlers for the tutor channels (T10): status, chat threads and turns, and
 * explanation pages, over `AppTutor` (`main/tutor/`).
 *
 * A chat turn is the `chat:send` stream. The renderer's cancel aborts the
 * stream's signal, which stops the turn (SPEC §7.3); a page that closes
 * cancels its streams too. `show_results` UI events are rewritten to the
 * practice `reportView`, the same redacted shape the Run button gets.
 */
import {
  ChatRefusal,
  TutorError,
  type ChatEvent,
  type Language,
  type RunView,
  type StoredMessage,
} from '@algorithm-tutor/core';
import type { ChatEventView, ChatMessageView, UiEventView } from '../../../shared/tutor';
import { reportView, type Practice } from '../../practice/service';
import type { AppTutor } from '../../tutor';
import { IpcRefusal, type IpcRouter } from '../router';

export interface TutorHandlerDeps {
  tutor: AppTutor;
  practice: Practice;
}

async function refusing<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ChatRefusal) throw new IpcRefusal(e.reason, e.message);
    if (e instanceof TutorError) throw new IpcRefusal(e.code ?? 'refused', e.message);
    throw e;
  }
}

export function messageView(m: StoredMessage): ChatMessageView {
  const out: ChatMessageView = { seq: m.seq, role: m.role, text: m.text, created_at: m.createdAt };
  if (m.action) out.action = m.action;
  if (m.slug) out.slug = m.slug;
  if (m.tools?.length) out.tools = m.tools.map((t) => ({ ...t }));
  if (m.stop) out.stop = m.stop;
  if (m.error) out.error = { ...m.error };
  return out;
}

/** A core chat event as the renderer gets it; `null` for a UI event it has no use for. */
export function eventView(
  e: ChatEvent,
  languageFor: (slug: string) => Language,
): ChatEventView | null {
  if (e.type !== 'ui_event') return e;
  const ev = e.event;
  const slug = typeof ev.slug === 'string' ? ev.slug : null;
  let out: UiEventView;
  switch (ev.action) {
    case 'refresh_state':
      out = { type: 'ui', action: 'refresh_state' };
      break;
    case 'open_problem':
    case 'open_explanation':
      if (!slug) return null;
      out = { type: 'ui', action: ev.action, slug };
      break;
    case 'show_results': {
      const report = ev.report as (RunView & { ok?: boolean }) | undefined;
      if (!slug || !report || !Array.isArray(report.cases)) return null;
      out = {
        type: 'ui',
        action: 'show_results',
        slug,
        report: reportView(slug, languageFor(slug), report),
      };
      break;
    }
    default:
      return null;
  }
  return { type: 'ui_event', event: out };
}

export function registerTutorHandlers(router: IpcRouter, deps: TutorHandlerDeps): void {
  const { tutor, practice } = deps;
  const languageFor = (slug: string) => practice.teaching.languageFor(slug);

  router.handle('tutor:status', () => tutor.status());

  router.handle('chat:thread', ({ thread }) =>
    refusing(() => ({
      thread,
      running: tutor.chat.isRunning(thread),
      messages: tutor.chat.transcript(thread).map(messageView),
    })),
  );

  router.handle('chat:reset', ({ thread }) =>
    refusing(async () => ({ thread, ...(await tutor.chat.reset(thread)) })),
  );

  router.handleStream('chat:send', (req, { signal, emit }) =>
    refusing(async () => {
      const request: Parameters<typeof tutor.chat.send>[0] = { thread: req.thread };
      if (req.text !== undefined) request.text = req.text;
      if (req.action) request.action = req.action;
      if (req.code !== undefined) request.code = req.code;
      const { message } = await tutor.chat.send(request, signal, (event) => {
        const view = eventView(event, languageFor);
        if (view) emit(view);
      });
      return { message: messageView(message) };
    }),
  );

  router.handle('explanations:list', ({ slug }) =>
    refusing(async () => {
      practice.teaching.summary(slug);
      return { slug, versions: await tutor.explanations.list(slug) };
    }),
  );

  router.handle('explanations:page', ({ slug, version }) =>
    refusing(async () => {
      practice.teaching.summary(slug);
      const page = await tutor.explanations.read(slug, version);
      if (!page) throw new IpcRefusal('not_found', `no explanation for ${slug}`);
      return { slug, version: page.id, html: page.html };
    }),
  );

  router.handle('explanations:viewed', ({ slug }) =>
    refusing(async () => ({
      slug,
      attempt_marked_explained: await practice.teaching.markExplained(slug),
    })),
  );
}
