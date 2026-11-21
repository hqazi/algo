/**
 * Read aloud (T37, T38, SPEC §15.6): the header button that starts and
 * stops it, the bar kept at the bottom of the reader while it is on (back,
 * play/pause, forward, where it is, speed, voice, stop), and the offer to
 * download the voice the first time.
 */
import { Pause, Play, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import { VOICES, type VoiceId } from '../../../shared/tts';
import { Dialog } from '../components/Dialog';
import { leaderKeys, useLeader } from '../components/leader';
import { Button, IconButton, Select } from '../components/ui';
import { engineText, formatMB } from './read-aloud-text';
import { RATES, type ReadAloud } from './useReadAloud';

function withKeys(text: string, keys: string | null): string {
  return keys ? `${text} (${keys})` : text;
}

export function ReadAloudButton({ speech }: { speech: ReadAloud }) {
  const leader = useLeader()?.label ?? null;
  const on = speech.status !== 'idle';
  const first =
    speech.installed === false && speech.info
      ? ` (downloads a ${formatMB(speech.info.bytes)} voice the first time)`
      : '';
  return (
    <IconButton
      aria-label={on ? 'Stop reading aloud' : 'Read aloud'}
      title={withKeys(
        on ? 'Stop reading aloud' : `Read aloud: from the top, or from the selected text${first}`,
        leaderKeys(leader, on ? 'x' : 'p'),
      )}
      size="sm"
      aria-pressed={on}
      disabled={speech.installed === null}
      icon={<Volume2 aria-hidden="true" />}
      onClick={() => (on ? speech.stop() : speech.start())}
      data-testid="read-aloud"
    />
  );
}

const ACCENTS = [
  { accent: 'US', label: 'American English' },
  { accent: 'UK', label: 'British English' },
] as const;

export function ReadAloudBar({ speech }: { speech: ReadAloud }) {
  const leader = useLeader()?.label ?? null;
  if (speech.status === 'idle' || !speech.at) return null;
  const paused = speech.status === 'paused';
  const loading = speech.status === 'loading';
  const { block, of } = speech.at;
  const engine = engineText(speech.info?.engine ?? null);
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
        aria-label={paused ? 'Resume' : 'Pause'}
        title={withKeys(paused ? 'Resume' : 'Pause', leaderKeys(leader, 'p'))}
        size="sm"
        icon={paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
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
      <span className="small muted read-aloud-at" aria-live="off" title={engine ?? undefined}>
        {block + 1} of {of}
      </span>
      {loading && (
        <span className="small muted read-aloud-loading" role="status">
          <span className="spinner" aria-hidden="true" />{' '}
          {speech.info?.engine ? 'Preparing…' : 'Starting the voice…'}
        </span>
      )}
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
        value={speech.prefs.voice}
        onChange={(e) => speech.setVoice(e.target.value as VoiceId)}
      >
        {ACCENTS.map((a) => (
          <optgroup key={a.accent} label={a.label}>
            {VOICES.filter((v) => v.accent === a.accent).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.gender})
              </option>
            ))}
          </optgroup>
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

/** The first time: what the download is, and its progress. */
export function ReadAloudOffer({ speech }: { speech: ReadAloud }) {
  if (!speech.offer) return null;
  const size = formatMB(speech.info?.bytes ?? 0);
  const d = speech.downloading;
  return (
    <Dialog
      titleId="read-aloud-offer"
      title="Download a voice for reading aloud?"
      onClose={speech.dismiss}
      backdropCloses={false}
      footer={
        <>
          <Button onClick={speech.dismiss}>{d ? 'Cancel download' : 'Not now'}</Button>
          <Button variant="primary" onClick={speech.download} disabled={!!d}>
            {d ? 'Downloading…' : `Download (${size})`}
          </Button>
        </>
      }
    >
      <p>
        Algo reads articles with Kokoro, an open-source voice model that runs on this computer. It
        is downloaded once from Hugging Face ({size}). After that, reading aloud works offline, and
        nothing you read leaves the computer.
      </p>
      <p className="small muted">
        It uses the graphics card when that is faster than the processor. You can remove the
        download in Settings → Library.
      </p>
      {d && (
        <div className="read-aloud-progress">
          <progress
            max={d.total || 1}
            value={d.received}
            aria-label="Voice download"
            aria-valuetext={`${formatMB(d.received)} of ${formatMB(d.total)}`}
          />
          <span className="small muted">
            {formatMB(d.received)} of {formatMB(d.total)}
          </span>
        </div>
      )}
    </Dialog>
  );
}
