import { describe, expect, it } from 'vitest';
import { formatType, parseType, someType, TypeParseError } from './neutral';

describe('parseType: valid types', () => {
  it.each([
    ['int', { kind: 'int' }],
    ['float', { kind: 'float' }],
    ['bool', { kind: 'bool' }],
    ['string', { kind: 'string' }],
    ['char', { kind: 'char' }],
    ['list<int>', { kind: 'list', of: { kind: 'int' } }],
    ['list<list<int>>', { kind: 'list', of: { kind: 'list', of: { kind: 'int' } } }],
    ['tuple<int,string>', { kind: 'tuple', items: [{ kind: 'int' }, { kind: 'string' }] }],
    [
      'tuple<int,int,float>',
      { kind: 'tuple', items: [{ kind: 'int' }, { kind: 'int' }, { kind: 'float' }] },
    ],
    ['map<string,int>', { kind: 'map', key: 'string', value: { kind: 'int' } }],
    [
      'map<int,list<string>>',
      { kind: 'map', key: 'int', value: { kind: 'list', of: { kind: 'string' } } },
    ],
    ['optional<int>', { kind: 'optional', of: { kind: 'int' } }],
    ['optional<list<int>>', { kind: 'optional', of: { kind: 'list', of: { kind: 'int' } } }],
    ['tree<int>', { kind: 'tree', of: { kind: 'int' } }],
    ['tree<string>', { kind: 'tree', of: { kind: 'string' } }],
    ['linked_list<int>', { kind: 'linked_list', of: { kind: 'int' } }],
    ['list<tree<int>>', { kind: 'list', of: { kind: 'tree', of: { kind: 'int' } } }],
    ['list<linked_list<int>>', { kind: 'list', of: { kind: 'linked_list', of: { kind: 'int' } } }],
    ['list<optional<int>>', { kind: 'list', of: { kind: 'optional', of: { kind: 'int' } } }],
  ])('%s', (text, expected) => {
    expect(parseType(text)).toEqual(expected);
    expect(formatType(parseType(text))).toBe(text);
  });

  it('ignores whitespace and formats canonically', () => {
    expect(formatType(parseType('  map< string , list< tuple<int, char> > >  '))).toBe(
      'map<string,list<tuple<int,char>>>',
    );
  });
});

describe('parseType: invalid types', () => {
  it.each([
    ['', /missing a type/],
    ['   ', /missing a type/],
    ['integer', /unknown type "integer"/],
    ['TreeNode | None', /unknown type "TreeNode"/],
    ['list[int]', /expected "<" but found "\["/],
    ['int | None', /unexpected "\|"/],
    ['List<int>', /unknown type "List"/],
    ['list', /expected "<" at the end/],
    ['list<>', /unknown type ">"|missing a type/],
    ['list<int', /expected ">" at the end/],
    ['list<int>>', /unexpected ">"/],
    ['list<int,int>', /expected ">" but found ","/],
    ['int<int>', /"int" takes no type arguments/],
    ['tuple<int>', /at least two items/],
    ['tuple<int,>', /missing a type|unknown type ">"/],
    ['map<float,int>', /map keys must be "string" or "int"/],
    ['map<list<int>,int>', /map keys must be "string" or "int"/],
    ['map<string>', /expected ","/],
    ['optional<optional<int>>', /optional<optional<…>> is not allowed/],
    ['tree<list<int>>', /tree<…> holds a scalar type/],
    ['linked_list<tree<int>>', /linked_list<…> holds a scalar type/],
    ['int int', /unexpected "int"/],
    [`${'list<'.repeat(50)}int${'>'.repeat(50)}`, /longer than 200/],
  ])('%j', (text, message) => {
    expect(() => parseType(text)).toThrow(TypeParseError);
    expect(() => parseType(text)).toThrow(message);
  });
});

describe('someType', () => {
  it('finds nested kinds', () => {
    const t = parseType('map<string,list<tuple<int,float>>>');
    expect(someType(t, (x) => x.kind === 'float')).toBe(true);
    expect(someType(t, (x) => x.kind === 'tree')).toBe(false);
  });
});
