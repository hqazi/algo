import { describe, expect, it } from 'vitest';
import { parseType } from './neutral';
import { pythonNodeClasses, pythonSignatureLine, pythonType } from './python';

describe('pythonType', () => {
  it.each([
    ['int', 'int'],
    ['float', 'float'],
    ['bool', 'bool'],
    ['string', 'str'],
    ['char', 'str'],
    ['list<list<int>>', 'list[list[int]]'],
    ['list<string>', 'list[str]'],
    ['tuple<int,string,float>', 'tuple[int, str, float]'],
    ['map<string,int>', 'dict[str, int]'],
    ['map<int,list<string>>', 'dict[int, list[str]]'],
    ['optional<int>', 'int | None'],
    ['list<optional<int>>', 'list[int | None]'],
    ['tree<int>', 'TreeNode | None'],
    ['linked_list<int>', 'ListNode | None'],
    ['list<linked_list<int>>', 'list[ListNode | None]'],
  ])('%s → %s', (neutral, python) => {
    expect(pythonType(parseType(neutral))).toBe(python);
  });
});

describe('pythonSignatureLine', () => {
  it('matches the dsa-tutor signature for level-lists', () => {
    const sig = {
      function: 'levels',
      params: [{ name: 'root', type: 'tree<int>' }],
      returns: 'list<list<int>>',
    };
    expect(pythonSignatureLine(sig)).toBe('def levels(root: TreeNode | None) -> list[list[int]]:');
    expect(pythonNodeClasses(sig)).toEqual(['TreeNode']);
  });

  it('lists every node class used, and none when there are none', () => {
    const sig = {
      function: 'f',
      params: [
        { name: 'a', type: 'tree<int>' },
        { name: 'b', type: 'list<int>' },
      ],
      returns: 'linked_list<int>',
    };
    expect(pythonSignatureLine(sig)).toBe(
      'def f(a: TreeNode | None, b: list[int]) -> ListNode | None:',
    );
    expect(pythonNodeClasses(sig)).toEqual(['ListNode', 'TreeNode']);
    expect(pythonNodeClasses({ function: 'g', params: [], returns: 'int' })).toEqual([]);
    expect(pythonSignatureLine({ function: 'g', params: [], returns: 'int' })).toBe(
      'def g() -> int:',
    );
  });
});
