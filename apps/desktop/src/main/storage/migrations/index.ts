/**
 * The schema migrations, in order. Each is a numbered SQL file in this folder
 * (`NNNN-name.sql`), applied once, in its own transaction (SPEC §4.2). Never
 * edit a migration that has shipped: add the next number instead.
 *
 * Files are imported as text so they are bundled into the main process; a
 * test checks this list matches the folder.
 */
import m0001 from './0001-initial.sql?raw';
import m0002 from './0002-library.sql?raw';
import m0003 from './0003-article-threads.sql?raw';
import m0004 from './0004-article-generated.sql?raw';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001-initial', sql: m0001 },
  { version: 2, name: '0002-library', sql: m0002 },
  { version: 3, name: '0003-article-threads', sql: m0003 },
  { version: 4, name: '0004-article-generated', sql: m0004 },
];
