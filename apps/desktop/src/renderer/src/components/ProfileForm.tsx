/**
 * The five questions of `content/references/questionnaire.md`, for onboarding
 * and Settings → Profile (ported from `dsa-tutor/web/src/components/ProfileForm.tsx`).
 * The comfort groups come from the topics, so a new group in `topics.md`
 * appears here without a code change; the known ones keep their labels.
 */
import { useMemo, useState, type FormEvent } from 'react';
import type { ProfileView, TopicView } from '../../../shared/practice';
import type { ProfileUpdate } from '../../../shared/settings';

const GROUP_LABELS: Record<string, string> = {
  basics: 'Basics (arrays, hashing, two pointers, sliding window, prefix sums)',
  linear: 'Linear (stacks, linked lists)',
  'search-sort': 'Search & sort',
  'trees-graphs': 'Trees & graphs (incl. heaps)',
  'recursion-dp': 'Recursion & DP (incl. greedy)',
};

type Comfort = 'none' | 'some' | 'solid';
type Goal = ProfileUpdate['goal'];
type Experience = ProfileUpdate['experience'];
type HintPreference = ProfileUpdate['hint_preference'];

const EXPERIENCE: Experience[] = ['beginner', 'intermediate', 'advanced'];

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

/** Topic groups in teaching order. */
function topicGroups(topics: TopicView[]): { id: string; label: string }[] {
  const seen: string[] = [];
  for (const t of topics) if (!seen.includes(t.group)) seen.push(t.group);
  return seen.map((id) => ({ id, label: GROUP_LABELS[id] ?? id }));
}

export interface ProfileFormProps {
  initial: ProfileView | null;
  topics: TopicView[];
  submitLabel: string;
  busy?: boolean;
  onSubmit: (update: ProfileUpdate) => void;
  /** Shown as a second button when given (onboarding's "use defaults"). */
  onDefaults?: () => void;
  defaultsLabel?: string;
}

export function ProfileForm({
  initial,
  topics,
  submitLabel,
  busy,
  onSubmit,
  onDefaults,
  defaultsLabel = 'Skip: use defaults',
}: ProfileFormProps) {
  const groups = useMemo(() => topicGroups(topics), [topics]);
  const [goal, setGoal] = useState<Goal>(
    oneOf(initial?.goal, ['general', 'interview'] as const, 'general'),
  );
  const [date, setDate] = useState(initial?.interview_date ?? '');
  const [experience, setExperience] = useState<Experience>(
    oneOf(initial?.experience, EXPERIENCE, 'beginner'),
  );
  const [comfort, setComfort] = useState<Record<string, Comfort>>(() =>
    Object.fromEntries(
      groups.map((g) => [
        g.id,
        oneOf(initial?.comfort[g.id], ['none', 'some', 'solid'] as const, 'none'),
      ]),
    ),
  );
  const [hint, setHint] = useState<HintPreference>(
    oneOf(initial?.hint_preference, ['early', 'struggle'] as const, 'early'),
  );
  const [focus, setFocus] = useState(initial?.focus_topic ?? '');

  function submit(e: FormEvent): void {
    e.preventDefault();
    onSubmit({
      goal,
      interview_date: goal === 'interview' && date ? date : null,
      experience,
      comfort: Object.fromEntries(groups.map((g) => [g.id, comfort[g.id] ?? 'none'])),
      hint_preference: hint,
      focus_topic: focus || null,
    });
  }

  return (
    <form className="profile-form" onSubmit={submit}>
      <fieldset>
        <legend>1. What is your goal?</legend>
        <label className="radio">
          <input
            type="radio"
            name="goal"
            value="general"
            checked={goal === 'general'}
            onChange={() => setGoal('general')}
          />{' '}
          General practice
        </label>
        <label className="radio">
          <input
            type="radio"
            name="goal"
            value="interview"
            checked={goal === 'interview'}
            onChange={() => setGoal('interview')}
          />{' '}
          Preparing for interviews
        </label>
        {goal === 'interview' && (
          <label className="field">
            Interview date (optional)
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>2. How much experience with data structures and algorithms do you have?</legend>
        {EXPERIENCE.map((x) => (
          <label className="radio" key={x}>
            <input
              type="radio"
              name="experience"
              value={x}
              checked={experience === x}
              onChange={() => setExperience(x)}
            />{' '}
            {x[0]!.toUpperCase() + x.slice(1)}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>3. How comfortable are you with each area?</legend>
        <div className="comfort-grid">
          {groups.map((g) => (
            <label className="field" key={g.id}>
              {g.label}
              <select
                value={comfort[g.id] ?? 'none'}
                onChange={(e) => setComfort({ ...comfort, [g.id]: e.target.value as Comfort })}
                aria-label={`Comfort: ${g.id}`}
              >
                <option value="none">None</option>
                <option value="some">Some</option>
                <option value="solid">Solid</option>
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>4. When you are stuck…</legend>
        <label className="radio">
          <input
            type="radio"
            name="hint"
            value="early"
            checked={hint === 'early'}
            onChange={() => setHint('early')}
          />{' '}
          Nudge me early
        </label>
        <label className="radio">
          <input
            type="radio"
            name="hint"
            value="struggle"
            checked={hint === 'struggle'}
            onChange={() => setHint('struggle')}
          />{' '}
          Let me struggle first
        </label>
      </fieldset>

      <fieldset>
        <legend>5. A topic to focus on right now?</legend>
        <select value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Focus topic">
          <option value="">Let the tutor choose</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </fieldset>

      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {submitLabel}
        </button>
        {onDefaults && (
          <button type="button" onClick={onDefaults} disabled={busy}>
            {defaultsLabel}
          </button>
        )}
      </div>
    </form>
  );
}
