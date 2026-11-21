/**
 * Read aloud (T37, SPEC §15.6): the header button that starts and stops it,
 * and the bar kept at the bottom of the reader while it is on: back,
 * play/pause, forward, where it is, speed, voice and stop.
 */
import { Pause, Play, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import { IconButton, Select } from '../components/ui';
import { leaderKeys, useLeader } from '../components/leader';
import { RATES, type ReadAloud } from './useReadAloud';

/** Why it cannot start, for the disabled button's tooltip. */
export const NO_VOICES =
  'Read aloud needs a text-to-speech voice on this computer; none was found ' +
  '(on Linux, install speech-dispatcher and a voice such as espeak-ng)';

function withKeys(text: string, keys: string | null): string {
  return keys ? `${text} (${keys})` : text;
}

export function ReadAloudButton({ speech }: { speech: ReadAloud }) {
  const leader = useLeader()?.label ?? null;
  const on = speech.status !== 'idle';
  return (
    <IconButton
      aria-label={on ? 'Stop reading aloud' : 'Read aloud'}
      title={
        speech.available
          ? withKeys(
              on ? 'Stop reading aloud' : 'Read aloud: from the top, or from the selected text',
              leaderKeys(leader, on ? 'x' : 'p'),
            )
          : NO_VOICES
      }
      size="sm"
      aria-pressed={on}
      disabled={!speech.available}
      icon={<Volume2 aria-hidden="true" />}
      onClick={() => (on ? speech.stop() : speech.start())}
      data-testid="read-aloud"
    />
  );
}

/** Voices in the app's language first, then by name. */
function sortVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  const mine = (v: SpeechSynthesisVoice): number => (v.lang.toLowerCase().startsWith(lang) ? 0 : 1);
  return [...voices].sort((a, b) => mine(a) - mine(b) || a.name.localeCompare(b.name));
}

export function ReadAloudBar({ speech }: { speech: ReadAloud }) {
  const leader = useLeader()?.label ?? null;
  if (speech.status === 'idle' || !speech.at) return null;
  const playing = speech.status === 'playing';
  const { block, of } = speech.at;
  return (
    <div className="read-aloud-bar" role="region" aria-label="Read aloud">
      <IconButton
        aria-label="Previous paragraph"
        title={withKeys('Previous paragraph', leaderKeys(leader, 'b'))}
        size="sm"
        icon={<SkipBack aria-hidden="true" />}
        onClick={() => speech.skip(-1)}
        disabled={block === 0}
      />
      <IconButton
        aria-label={playing ? 'Pause' : 'Resume'}
        title={withKeys(playing ? 'Pause' : 'Resume', leaderKeys(leader, 'p'))}
        size="sm"
        icon={playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        onClick={speech.toggle}
      />
      <IconButton
        aria-label="Next paragraph"
        title={withKeys('Next paragraph', leaderKeys(leader, 'n'))}
        size="sm"
        icon={<SkipForward aria-hidden="true" />}
        onClick={() => speech.skip(1)}
        disabled={block >= of - 1}
      />
      <span className="small muted read-aloud-at" aria-live="off">
        {block + 1} of {of}
      </span>
      <span className="spacer" />
      <Select
        aria-label="Speed"
        title="Speed"
        className="read-aloud-rate"
        value={String(speech.prefs.rate)}
        onChange={(e) => speech.setRate(Number(e.target.value))}
      >
        {RATES.map((r) => (
          <option key={r} value={String(r)}>
            {r}×
          </option>
        ))}
      </Select>
      <Select
        aria-label="Voice"
        title="Voice"
        wrapperClassName="read-aloud-voice"
        value={speech.prefs.voice ?? ''}
        onChange={(e) => speech.setVoice(e.target.value || null)}
      >
        <option value="">System default</option>
        {sortVoices(speech.voices).map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} ({v.lang})
          </option>
        ))}
      </Select>
      <IconButton
        aria-label="Stop reading aloud"
        title={withKeys('Stop', leaderKeys(leader, 'x'))}
        size="sm"
        icon={<X aria-hidden="true" />}
        onClick={speech.stop}
      />
    </div>
  );
}
