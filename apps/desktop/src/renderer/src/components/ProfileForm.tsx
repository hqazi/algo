/**
 * The five questions of `content/references/questionnaire.md`, for onboarding
 * and Settings → Profile (ported from `dsa-tutor/web/src/components/ProfileForm.tsx`).
 * The comfort groups come from the topics, so a new group in `topics.md`
 * appears here without a code change; the known ones keep their labels.
 *
 * `layout="steps"` (onboarding, T33) shows one question at a time with a
 * step indicator, Back / Continue and the defaults button on every step;
 * `layout="all"` (Settings) shows every question at once. Both save the same
 * answers in one `onSubmit` call.
 */
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ProfileView, TopicView } from '../../../shared/practice';
import type { ProfileUpdate } from '../../../shared/settings';
import { Button } from './ui';
import '../pages/onboarding.css';

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

const EXPERIENCE: { value: Experience; label: string; help: string }[] = [
  { value: 'beginner', label: 'Beginner', help: 'New to most data structures and algorithms.' },
  { value: 'intermediate', label: 'Intermediate', help: 'Know the basics and want practice.' },
  { value: 'advanced', label: 'Advanced', help: 'Comfortable, and after harder problems.' },
];
const GOALS: { value: Goal; label: string; help: string }[] = [
  { value: 'general', label: 'General practice', help: 'Learn and practise at your own pace.' },
  {
    value: 'interview',
    label: 'Preparing for interviews',
    help: 'Practise for coding interviews, with a date if you have one.',
  },
];
const HINTS: { value: HintPreference; label: string; help: string }[] = [
  { value: 'early', label: 'Nudge me early', help: 'The tutor offers a small hint soon.' },
  {
    value: 'struggle',
    label: 'Let me struggle first',
    help: 'The tutor holds back until you have had a real go.',
  },
];

const QUESTIONS = [
  'What is your goal?',
  'How much experience with data structures and algorithms do you have?',
  'How comfortable are you with each area?',
  'When you are stuck…',
  'A topic to focus on right now?',
] as const;

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

/** Topic groups in teaching order. */
function topicGroups(topics: TopicView[]): { id: string; label: string }[] {
  const seen: string[] = [];
  for (const t of topics) if (!seen.includes(t.group)) seen.push(t.group);
  return seen.map((id) => ({ id, label: GROUP_LABELS[id] ?? id }));
}

/** A radio as a card: the label is the title (the input's name), the help its description. */
function Choices<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { value: T; label: string; help: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="choice-cards">
      {options.map((o) => {
        const input = `${id}-${o.value}`;
        return (
          <div className="choice-card" key={o.value}>
            <input
              type="radio"
              id={input}
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              aria-describedby={`${input}-help`}
            />
            <label htmlFor={input} className="choice-title">
              {o.label}
            </label>
            <span id={`${input}-help`} className="choice-help">
              {o.help}
            </span>
          </div>
        );
      })}
    </div>
  );
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
  /** One question at a time (onboarding) or all at once (Settings). */
  layout?: 'steps' | 'all';
}

export function ProfileForm({
  initial,
  topics,
  submitLabel,
  busy,
  onSubmit,
  onDefaults,
  defaultsLabel = 'Skip: use defaults',
  layout = 'all',
}: ProfileFormProps) {
  const groups = useMemo(() => topicGroups(topics), [topics]);
  const [goal, setGoal] = useState<Goal>(
    oneOf(initial?.goal, ['general', 'interview'] as const, 'general'),
  );
  const [date, setDate] = useState(initial?.interview_date ?? '');
  const [experience, setExperience] = useState<Experience>(
    oneOf(
      initial?.experience,
      EXPERIENCE.map((x) => x.value),
      'beginner',
    ),
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
  const steps = layout === 'steps';
  const [step, setStep] = useState(0);
  const last = QUESTIONS.length - 1;
  const stepBox = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // After Back or Continue, focus the new question's first control.
  useEffect(() => {
    if (!steps || !moved.current) return;
    stepBox.current
      ?.querySelector<HTMLElement>('input:checked, input, select, textarea')
      ?.focus();
  }, [step, steps]);

  function go(to: number): void {
    moved.current = true;
    setStep(Math.max(0, Math.min(last, to)));
  }

  function submit(e: FormEvent): void {
    e.preventDefault();
    if (steps && step < last) {
      go(step + 1);
      return;
    }
    onSubmit({
      goal,
      interview_date: goal === 'interview' && date ? date : null,
      experience,
      comfort: Object.fromEntries(groups.map((g) => [g.id, comfort[g.id] ?? 'none'])),
      hint_preference: hint,
      focus_topic: focus || null,
    });
  }

  const legend = (i: number) => (steps ? QUESTIONS[i] : `${i + 1}. ${QUESTIONS[i]}`);
  const questions: ReactNode[] = [
    <fieldset key="goal">
      <legend>{legend(0)}</legend>
      <Choices name="goal" options={GOALS} value={goal} onChange={setGoal} />
      {goal === 'interview' && (
        <label className="field interview-date">
          Interview date (optional)
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
    </fieldset>,
    <fieldset key="experience">
      <legend>{legend(1)}</legend>
      <Choices name="experience" options={EXPERIENCE} value={experience} onChange={setExperience} />
    </fieldset>,
    <fieldset key="comfort">
      <legend>{legend(2)}</legend>
      <div className="comfort-grid">
        {groups.map((g) => (
          <label className="comfort-row" key={g.id}>
            <span>{g.label}</span>
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
    </fieldset>,
    <fieldset key="hint">
      <legend>{legend(3)}</legend>
      <Choices name="hint" options={HINTS} value={hint} onChange={setHint} />
    </fieldset>,
    <fieldset key="focus">
      <legend>{legend(4)}</legend>
      <select value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Focus topic">
        <option value="">Let the tutor choose</option>
        {topics.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {steps && (
        <p className="muted small">
          Any answer can be changed later in Settings → Profile.
        </p>
      )}
    </fieldset>,
  ];

  if (!steps)
    return (
      <form className="profile-form profile-form-all" onSubmit={submit}>
        {questions}
        <div className="actions">
          {onDefaults && (
            <Button onClick={onDefaults} disabled={busy}>
              {defaultsLabel}
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    );

  return (
    <form className="profile-form profile-form-steps" onSubmit={submit}>
      <div className="stepper">
        <ol className="stepper-dots" aria-hidden="true">
          {QUESTIONS.map((q, i) => (
            <li key={q} className={i < step ? 'done' : i === step ? 'current' : ''} />
          ))}
        </ol>
        <p className="stepper-text" aria-live="polite" data-testid="step-indicator">
          Question {step + 1} of {QUESTIONS.length}
        </p>
      </div>
      <div className="onboarding-step" ref={stepBox}>
        {questions[step]}
      </div>
      <div className="onboarding-actions">
        {onDefaults && (
          <Button variant="ghost" onClick={onDefaults} disabled={busy}>
            {defaultsLabel}
          </Button>
        )}
        <span className="spacer" />
        {step > 0 && (
          <Button icon={<ArrowLeft aria-hidden="true" />} onClick={() => go(step - 1)}>
            Back
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {step < last ? 'Continue' : submitLabel}
          {step < last && <ArrowRight aria-hidden="true" />}
        </Button>
      </div>
    </form>
  );
}
