/**
 * Topic ids from `content/references/topics.md`, for the content scripts.
 * The parser is core's (`packages/core/src/teaching/topics.ts`).
 */
import { readFile } from 'node:fs/promises';
import { parseTopics, type Topic } from '../../packages/core/src/teaching/topics';

export { parseTopics };
export type TopicRow = Topic;

export async function readTopics(path: string): Promise<Set<string>> {
  return new Set(parseTopics(await readFile(path, 'utf8')).map((r) => r.id));
}
