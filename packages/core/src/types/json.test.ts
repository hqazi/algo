import { describe, expect, it } from 'vitest';
import { parseJson, stringifyJson } from './json';

describe('parseJson', () => {
  it('keeps integers beyond 2^53 exact as bigint', () => {
    expect(parseJson('[999999999999999999, -9223372036854775808]')).toEqual([
      999999999999999999n,
      -9223372036854775808n,
    ]);
  });

  it('keeps safe integers and other numbers as numbers', () => {
    expect(parseJson('[9007199254740991, -9007199254740991, 1.5, 1e20, 2.0, -0]')).toEqual([
      9007199254740991, -9007199254740991, 1.5, 1e20, 2, -0,
    ]);
  });

  it('parses everything else like JSON.parse', () => {
    const text = '{"a": [true, null, "x\\u00e9"], "b": {"c": 0.25}}';
    expect(parseJson(text)).toEqual(JSON.parse(text));
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJson('[1,')).toThrow(SyntaxError);
  });
});

describe('stringifyJson', () => {
  it('writes bigints as plain integers and round-trips', () => {
    const text = '{"n":4660046610375530309,"m":[-9223372036854775808,1,2.5]}';
    expect(stringifyJson(parseJson(text))).toBe(text);
  });

  it('matches JSON.stringify for ordinary values', () => {
    const value = {
      a: [1, 'two', null, true, undefined, { b: undefined }],
      c: 'é"\n',
      d: NaN,
      e: {},
    };
    expect(stringifyJson(value)).toBe(JSON.stringify(value));
    expect(stringifyJson(value, 2)).toBe(JSON.stringify(value, null, 2));
    expect(stringifyJson([])).toBe('[]');
  });

  it('does not touch strings that look like markers', () => {
    expect(stringifyJson(['\u0000bigint:12'])).toBe(JSON.stringify(['\u0000bigint:12']));
  });

  it('rejects values JSON cannot hold', () => {
    expect(() => stringifyJson(undefined)).toThrow(TypeError);
  });
});
