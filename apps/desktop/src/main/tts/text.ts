/**
 * Text to Kokoro's input (T38, D-59): normalize the text, turn it into
 * phonemes with eSpeak NG (the `phonemizer` package, eSpeak compiled to
 * WebAssembly, so nothing is installed on the system), and map the phonemes
 * to the model's token ids.
 *
 * Ported from kokoro-js 1.2.1 (`phonemize.js`, Apache-2.0, by hexgrad and
 * Xenova), which does the same for Kokoro in the browser; the app runs the
 * model with onnxruntime-node instead of transformers.js, so it keeps only
 * this part. The phonemizer is passed in so tests can stand in for it.
 */

export type Phonemize = (text: string, language: string) => Promise<string[]>;

/** Years ("1990" → "19 90"), times ("3:05" → "3 oh 5"); decimals are left for `pointNum`. */
function splitNum(s: string): string {
  if (s.includes('.')) return s;
  if (s.includes(':')) {
    const [h, m] = s.split(':').map(Number);
    if (m === 0) return `${h} o'clock`;
    return m !== undefined && m < 10 ? `${h} oh ${m}` : `${h} ${m}`;
  }
  const year = parseInt(s.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return s;
  const left = s.slice(0, 2);
  const right = parseInt(s.slice(2, 4), 10);
  const plural = s.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${plural}`;
    if (right < 10) return `${left} oh ${right}${plural}`;
  }
  return `${left} ${right}${plural}`;
}

/** "$5.50" → "5 dollars and 50 cents". */
function flipMoney(s: string): string {
  const unit = s[0] === '$' ? 'dollar' : 'pound';
  const amount = s.slice(1);
  if (isNaN(Number(amount))) return `${amount} ${unit}s`;
  if (!s.includes('.')) return `${amount} ${unit}${amount === '1' ? '' : 's'}`;
  const [whole = '', frac = ''] = amount.split('.');
  const n = parseInt(frac.padEnd(2, '0'), 10);
  const small = s[0] === '$' ? (n === 1 ? 'cent' : 'cents') : n === 1 ? 'penny' : 'pence';
  return `${whole} ${unit}${whole === '1' ? '' : 's'} and ${n} ${small}`;
}

/** "3.14" → "3 point 1 4". */
function pointNum(s: string): string {
  const [a = '', b = ''] = s.split('.');
  return `${a} point ${b.split('').join(' ')}`;
}

export function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, '“')
    .replace(/»/g, '”')
    .replace(/[“”]/g, '"')
    .replace(/\(/g, '«')
    .replace(/\)/g, '»')
    .replace(/、/g, ', ')
    .replace(/。/g, '. ')
    .replace(/！/g, '! ')
    .replace(/，/g, ', ')
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(
      /[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi,
      flipMoney,
    )
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim();
}

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_RUN = new RegExp(
  `(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`,
  'g',
);

/** The text in runs of punctuation (kept as they are) and runs of words (phonemized). */
function splitPunctuation(text: string): { punct: boolean; text: string }[] {
  const out: { punct: boolean; text: string }[] = [];
  let at = 0;
  for (const m of text.matchAll(PUNCTUATION_RUN)) {
    if (at < m.index) out.push({ punct: false, text: text.slice(at, m.index) });
    if (m[0].length > 0) out.push({ punct: true, text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ punct: false, text: text.slice(at) });
  return out;
}

/** Phonemes for `text`; `accent` is the voice id's first letter (`a` American, `b` British). */
export async function toPhonemes(
  text: string,
  accent: 'a' | 'b',
  phonemize: Phonemize,
): Promise<string> {
  const language = accent === 'a' ? 'en-us' : 'en';
  const parts = await Promise.all(
    splitPunctuation(normalizeText(text)).map(async (p) =>
      p.punct ? p.text : (await phonemize(p.text, language)).join(' '),
    ),
  );
  let ph = parts
    .join('')
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (accent === 'a') ph = ph.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return ph.trim();
}

/** Kokoro v1.0's vocabulary (`tokenizer.json`): one token per phoneme symbol; `$` pads. */
// prettier-ignore
const VOCAB: Record<string, number> = {"$":0,";":1,":":2,",":3,".":4,"!":5,"?":6,"—":9,"…":10,"\"":11,"(":12,")":13,"“":14,"”":15," ":16,"̃":17,"ʣ":18,"ʥ":19,"ʦ":20,"ʨ":21,"ᵝ":22,"ꭧ":23,"A":24,"I":25,"O":31,"Q":33,"S":35,"T":36,"W":39,"Y":41,"ᵊ":42,"a":43,"b":44,"c":45,"d":46,"e":47,"f":48,"h":50,"i":51,"j":52,"k":53,"l":54,"m":55,"n":56,"o":57,"p":58,"q":59,"r":60,"s":61,"t":62,"u":63,"v":64,"w":65,"x":66,"y":67,"z":68,"ɑ":69,"ɐ":70,"ɒ":71,"æ":72,"β":75,"ɔ":76,"ɕ":77,"ç":78,"ɖ":80,"ð":81,"ʤ":82,"ə":83,"ɚ":85,"ɛ":86,"ɜ":87,"ɟ":90,"ɡ":92,"ɥ":99,"ɨ":101,"ɪ":102,"ʝ":103,"ɯ":110,"ɰ":111,"ŋ":112,"ɳ":113,"ɲ":114,"ɴ":115,"ø":116,"ɸ":118,"θ":119,"œ":120,"ɹ":123,"ɾ":125,"ɻ":126,"ʁ":128,"ɽ":129,"ʂ":130,"ʃ":131,"ʈ":132,"ʧ":133,"ʊ":135,"ʋ":136,"ʌ":138,"ɣ":139,"ɤ":140,"χ":142,"ʎ":143,"ʒ":147,"ʔ":148,"ˈ":156,"ˌ":157,"ː":158,"ʰ":162,"ʲ":164,"↓":169,"→":171,"↗":172,"↘":173,"ᵻ":177};

/** The model takes at most this many tokens, the two pads included. */
export const MAX_TOKENS = 512;

/** Token ids for `phonemes`: unknown symbols dropped, padded with `$` at both ends, cut to fit. */
export function tokenize(phonemes: string): number[] {
  const ids: number[] = [];
  for (const ch of phonemes) {
    const id = VOCAB[ch];
    if (id !== undefined) ids.push(id);
  }
  return [0, ...ids.slice(0, MAX_TOKENS - 2), 0];
}
