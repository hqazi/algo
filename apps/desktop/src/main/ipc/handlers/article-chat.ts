/**
 * Handlers for chats on passages (T24, SPEC §15.5): an article's threads, a
 * new thread for a passage, renaming, and the one-time provider notice.
 * Turns and transcripts go through the `chat:*` channels.
 */
import { ChatRefusal, parseAnchor, type Storage } from '@algo/core';
import type { ArticleThreadView } from '../../../shared/article-chat';
import type { AppTutor } from '../../tutor';
import { IpcRefusal, type IpcRouter } from '../router';

/** `meta` key: the user has seen that passages are sent to the provider. */
export const NOTICE_KEY = 'library.chat_notice_seen';

export interface ArticleChatDeps {
  tutor: AppTutor;
  storage: Storage;
  /** Whether the article is in the library (its index row exists). */
  hasArticle: (id: string) => boolean;
  newId: () => string;
}

async function refusing<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ChatRefusal) throw new IpcRefusal(e.reason, e.message);
    throw e;
  }
}

export function registerArticleChatHandlers(router: IpcRouter, deps: ArticleChatDeps): void {
  const { tutor, storage } = deps;

  router.handle('library:threads', ({ article }) =>
    refusing(() => ({
      article,
      threads: tutor.chat.articleThreads(article).map((t): ArticleThreadView => ({
        id: t.id,
        title: t.title,
        anchor: parseAnchor(t.anchor),
        created_at: t.createdAt,
        last_at: t.lastAt,
        messages: t.messages,
      })),
    })),
  );

  router.handle('library:thread-create', ({ article, anchor }) =>
    refusing(async () => {
      if (!deps.hasArticle(article))
        throw new IpcRefusal('not_found', 'That article is not in the library.');
      const thread = `article:${deps.newId()}`;
      await tutor.chat.createArticleThread(thread, article, anchor);
      return { thread };
    }),
  );

  router.handle('library:thread-rename', ({ thread, title }) =>
    refusing(async () => ({ thread, ...(await tutor.chat.renameThread(thread, title)) })),
  );

  router.handle('library:chat-notice', async ({ ack }) => {
    if (ack) await storage.write((db) => db.setMeta(NOTICE_KEY, '1'));
    return { seen: storage.read((db) => db.getMeta(NOTICE_KEY)) === '1' };
  });
}
