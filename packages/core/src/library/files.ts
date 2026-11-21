/**
 * Names and paths for changing library folders from the app (T42, SPEC
 * §15.1): new folders, moves and deletes, and (T43) the tutor's files. Pure:
 * main checks every path the renderer sends with these before touching the
 * disk, then checks the real paths again.
 *
 * A path is inside one library folder, uses `/`, and has no empty, `.`,
 * `..` or dot-name parts (dot names are skipped by the scan, so a folder
 * made with one would vanish).
 */

/** Longest name for one file or folder (most file systems allow 255 bytes). */
export const MAX_ENTRY_NAME = 120;
/** Deepest folder path the app makes or moves into. */
export const MAX_PATH_PARTS = 32;

// Windows refuses these names with any extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// Characters Windows, macOS or Obsidian refuse in a name, and controls.
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*#^[\]]/;

/** Why `name` cannot be a file or folder name, or `null` if it can. */
export function entryNameProblem(name: string): string | null {
  if (!name) return 'Give a name.';
  if (name !== name.trim()) return 'A name cannot start or end with a space.';
  if (name.length > MAX_ENTRY_NAME) return `A name can have at most ${MAX_ENTRY_NAME} characters.`;
  if (name.startsWith('.')) return 'A name cannot start with a dot.';
  if (name.endsWith('.')) return 'A name cannot end with a dot.';
  if (BAD_CHARS.test(name)) return 'A name cannot contain < > : " / \\ | ? * # ^ [ ].';
  if (RESERVED.test(name)) return 'That name is reserved by Windows.';
  return null;
}

/**
 * The parts of a path inside a library folder (`''` is the folder itself),
 * or `null` if any part is not a name `entryNameProblem` accepts.
 */
export function pathParts(path: string): string[] | null {
  if (path === '') return [];
  const parts = path.split('/');
  if (parts.length > MAX_PATH_PARTS) return null;
  return parts.every((p) => entryNameProblem(p) === null) ? parts : null;
}

/** `a/b/c.md` → `a/b`; `c.md` → `''`. */
export function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** `a/b/c.md` → `c.md`. */
export function entryName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

/** True if `path` is `dir` or inside it (`dir` `''` holds everything). */
export function isWithin(path: string, dir: string): boolean {
  return dir === '' || path === dir || path.startsWith(`${dir}/`);
}

/**
 * A file name for a note titled `title`: the title with the characters a
 * name cannot hold replaced, trimmed and capped, plus `.md`; made unique
 * with ` 2`, ` 3`… `prefix` (e.g. `01 `) goes before it.
 */
export function noteFileName(title: string, taken: (name: string) => boolean, prefix = ''): string {
  const room = MAX_ENTRY_NAME - prefix.length - 8;
  let base = title
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, room)
    .replace(/[\s.]+$/, '');
  if (!base || RESERVED.test(base)) base = base ? `${base} note` : 'Article';
  const name = (n: number) => `${prefix}${base}${n > 1 ? ` ${n}` : ''}.md`;
  for (let n = 1; n < 10_000; n++) if (!taken(name(n))) return name(n);
  throw new Error('no free file name');
}
