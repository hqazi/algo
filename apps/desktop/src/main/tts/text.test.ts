/**
 * Text to Kokoro tokens (T38): kokoro-js's normalization, phonemes from the
 * real eSpeak NG (WebAssembly, no network), and the vocabulary.
 */
import { phonemize } from 'phonemizer';
import { describe, expect, it } from 'vitest';
import { MAX_TOKENS, normalizeText, tokenize, toPhonemes } from './text';

describe('normalizeText', () => {
  it('reads numbers, money, titles and abbreviations as words', () => {
    expect(normalizeText('In 1990 it cost $5.50.')).toBe(
      'In 19 90 it cost 5 dollars and 50 cents.',
    );
    expect(normalizeText('Dr. Smith met Mr. Jones at 3:05.')).toBe(
      'Doctor Smith met Mister Jones at 3 oh 5.',
    );
    expect(normalizeText('pi is 3.14')).toBe('pi is 3 point 1 4');
    expect(normalizeText('pages 2-3 (roughly)')).toBe('pages 2 to 3 «roughly»');
    expect(normalizeText('“quoted”  text')).toBe('"quoted" text');
  });
});

describe('toPhonemes', () => {
  it('phonemizes words with eSpeak NG and keeps punctuation', async () => {
    expect(await toPhonemes('Binary search, sorted list.', 'a', phonemize)).toBe(
      'bˈaɪnɚɹi sˈɜːtʃ, sˈɔːɹɾᵻd lˈɪst.',
    );
    // British: no flapped t, a long o.
    expect(await toPhonemes('sorted', 'b', phonemize)).toBe('sˈɔːtɪd');
  });
});

describe('tokenize', () => {
  it('maps symbols to ids, drops unknown ones, and pads with $', () => {
    expect(tokenize('hi.')).toEqual([0, 50, 51, 4, 0]);
    expect(tokenize('h☃i')).toEqual([0, 50, 51, 0]);
  });

  it('cuts to the model limit', () => {
    const ids = tokenize('a'.repeat(1000));
    expect(ids).toHaveLength(MAX_TOKENS);
    expect(ids[0]).toBe(0);
    expect(ids.at(-1)).toBe(0);
  });
});
