import { describe, expect, it } from 'vitest';
import { parseJson } from './json';
import { parseType } from './neutral';
import { checkValue } from './values';

const ok = (type: string, json: string, canonical = false): string[] =>
  checkValue(parseJson(json), parseType(type), 'v', { canonical });

describe('checkValue: accepted values', () => {
  it.each([
    ['int', '0'],
    ['int', '-42'],
    ['int', '9007199254740991'],
    ['int', '9223372036854775807'],
    ['int', '-9223372036854775808'],
    ['int', '2.0'], // indistinguishable from 2 once parsed
    ['float', '1.5'],
    ['float', '3'],
    ['float', '1e300'],
    ['bool', 'false'],
    ['string', '""'],
    ['string', '"hello"'],
    ['char', '"a"'],
    ['char', '"é"'],
    ['char', '"😀"'],
    ['list<int>', '[]'],
    ['list<list<int>>', '[[1], [], [2, 3]]'],
    ['tuple<int,string>', '[1, "a"]'],
    ['map<string,int>', '{"a": 1, "": 2}'],
    ['map<int,string>', '{"0": "a", "-7": "b", "123": "c"}'],
    ['optional<int>', 'null'],
    ['optional<int>', '5'],
    ['list<optional<string>>', '["a", null]'],
    ['tree<int>', '[]'],
    ['tree<int>', '[1]'],
    ['tree<int>', '[3, 9, 20, null, null, 15, 7]'],
    ['tree<int>', '[1, null, 2, 3]'],
    ['tree<int>', '[1, 2, null, 3]'],
    ['tree<int>', '[1, 2, 3, null, null]'], // trailing nulls allowed in inputs
    ['linked_list<int>', '[]'],
    ['linked_list<int>', '[1, 2, 3]'],
  ])('%s accepts %s', (type, json) => {
    expect(ok(type, json)).toEqual([]);
  });
});

describe('checkValue: rejected values', () => {
  it.each([
    ['int', '1.5', /expected int, got number 1.5/],
    ['int', '"1"', /expected int, got string "1"/],
    ['int', 'true', /expected int, got boolean true/],
    ['int', 'null', /expected int, got null/],
    ['int', '9223372036854775808', /outside the 64-bit range/],
    ['int', '1e20', /written as plain digits/],
    ['float', '"1.5"', /expected float/],
    ['bool', '0', /expected bool, got number 0/],
    ['string', '1', /expected string/],
    ['char', '""', /expected char/],
    ['char', '"ab"', /expected char/],
    ['list<int>', '{}', /expected list, got an object/],
    ['list<int>', '[1, "2"]', /v\[1\]: expected int/],
    ['list<list<int>>', '[[1], [2, 3.5]]', /v\[1\]\[1\]: expected int/],
    ['tuple<int,string>', '[1]', /expected tuple of 2 items, got an array of 1/],
    ['tuple<int,string>', '[1, 2]', /v\[1\]: expected string/],
    ['map<string,int>', '[]', /expected map/],
    ['map<string,int>', '{"a": "x"}', /v\["a"\]: expected int/],
    ['map<int,int>', '{"01": 1}', /key "01" is not an integer/],
    ['map<int,int>', '{"a": 1}', /key "a" is not an integer/],
    ['map<int,int>', '{"1.5": 1}', /key "1.5" is not an integer/],
    ['optional<int>', '"x"', /expected int/],
    ['tree<int>', 'null', /expected tree/],
    ['tree<int>', '[null]', /tree root is null/],
    ['tree<int>', '[null, 1]', /tree root is null/],
    ['tree<int>', '[1, null, null, 5]', /from position 3 on that belong to no node/],
    ['tree<int>', '[1, 2, "x"]', /v\[2\]: expected int/],
    ['linked_list<int>', '[1, null]', /v\[1\]: expected int, got null/],
    ['linked_list<int>', '{"val": 1}', /expected linked_list/],
  ])('%s rejects %s', (type, json, message) => {
    const errors = ok(type, json);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(message);
  });
});

describe('checkValue: canonical (expected) values', () => {
  it('rejects trailing nulls in trees', () => {
    expect(ok('tree<int>', '[1, 2, null]', true).join()).toMatch(/ends with null/);
    expect(ok('tree<int>', '[1, null, 2]', true)).toEqual([]);
  });
});

describe('checkValue: error limits', () => {
  it('stops after maxErrors', () => {
    const errors = checkValue(['a', 'b', 'c', 'd'], parseType('list<int>'), 'v', { maxErrors: 2 });
    expect(errors).toHaveLength(2);
  });
});
