/**
 * The learner's solution files (SPEC §4.1: `workspace/<slug>/solution.<ext>`),
 * behind an interface so core does no file I/O, and the starter code written
 * when a problem is started. Ported from `dsa-tutor/dsa_tutor/core/problems.py`
 * (`scaffold_source`, `scaffold_workspace`).
 */
import { goStub } from '../langs/go';
import { rustStub } from '../langs/rust';
import type { ProblemMeta } from '../problems/schema';
import { pythonNodeClasses, pythonSignatureLine } from '../types/python';
import type { Language } from '../types/signature';

export const SOLUTION_FILES: Record<Language, string> = {
  python: 'solution.py',
  rust: 'solution.rs',
  go: 'solution.go',
};

export interface Workspace {
  /** The saved solution, or `null` if there is none. */
  read(slug: string, language: Language): Promise<string | null>;
  /** Write `content` unless a solution exists; `created` says which. */
  create(slug: string, language: Language, content: string): Promise<{ created: boolean }>;
}

/** The path shown to the learner and the tutor, relative to the data folder. */
export function workspacePath(slug: string, language: Language): string {
  return `workspace/${slug}/${SOLUTION_FILES[language]}`;
}

const NODE_CLASSES = {
  ListNode: [
    'class ListNode:',
    '    def __init__(self, val=0, next=None):',
    '        self.val = val',
    '        self.next = next',
  ],
  TreeNode: [
    'class TreeNode:',
    '    def __init__(self, val=0, left=None, right=None):',
    '        self.val = val',
    '        self.left = left',
    '        self.right = right',
  ],
} as const;

/** The starter file for a problem in `language` (Python only until T15). */
export function starterCode(meta: ProblemMeta, language: Language, topicName: string): string {
  const sig = meta.signature;
  if (language !== 'python') {
    const header = [
      `${meta.title} (${topicName}, ${meta.difficulty})`,
      '',
      'Write your solution here; Run tests in the app checks it.',
    ];
    return language === 'rust' ? rustStub(sig, { header }) : goStub(sig, { header });
  }
  const lines = [
    `"""${meta.title} (${topicName}, ${meta.difficulty})`,
    '',
    'Write your solution here; Run tests in the app checks it.',
    '"""',
  ];
  for (const name of pythonNodeClasses(sig)) {
    lines.push(
      '',
      '# Provided: the tests build inputs with this class. Do not change it.',
      ...NODE_CLASSES[name],
    );
  }
  lines.push(
    '',
    '',
    pythonSignatureLine(sig),
    '    # Your code here',
    '    raise NotImplementedError',
    '',
  );
  return lines.join('\n');
}

/** A workspace in memory (tests). */
export function memoryWorkspace(): Workspace & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (slug, language) => Promise.resolve(files.get(workspacePath(slug, language)) ?? null),
    create: (slug, language, content) => {
      const key = workspacePath(slug, language);
      if (files.has(key)) return Promise.resolve({ created: false });
      files.set(key, content);
      return Promise.resolve({ created: true });
    },
  };
}
