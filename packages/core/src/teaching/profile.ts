/**
 * The learner profile: onboarding answers and the focus topic. Ported from
 * `dsa-tutor/dsa_tutor/core/state.py` (`default_profile`, `set_profile_value`).
 */
import type { ProfileRecord } from '../storage';
import type { Language } from '../types/signature';
import { TutorError } from './errors';
import { topicGroups, type Topic } from './topics';

export const COMFORT = ['none', 'some', 'solid'] as const;
export type Comfort = (typeof COMFORT)[number];

export const PROFILE_CHOICES = {
  goal: ['interview', 'general'],
  experience: ['beginner', 'intermediate', 'advanced'],
  hint_preference: ['early', 'struggle'],
} as const;

export const PROFILE_KEYS =
  'goal, interview_date, experience, comfort.<group>|comfort.all, hint_preference, focus_topic, language';

/** The profile as tools and the UI show it. */
export interface ProfileView {
  goal: string;
  interview_date: string | null;
  experience: string;
  comfort: Record<string, string>;
  hint_preference: string;
  focus_topic: string | null;
  language: Language;
  created_at: string;
  updated_at: string;
}

export function defaultProfile(topics: readonly Topic[], now: string): ProfileRecord {
  return {
    goal: 'general',
    interviewDate: null,
    experience: 'beginner',
    comfort: Object.fromEntries(topicGroups(topics).map((g) => [g, 'none'])),
    hintPreference: 'early',
    focusTopic: null,
    language: 'python',
    onboarded: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function profileView(p: ProfileRecord): ProfileView {
  return {
    goal: p.goal,
    interview_date: p.interviewDate,
    experience: p.experience,
    comfort: { ...p.comfort },
    hint_preference: p.hintPreference,
    focus_topic: p.focusTopic,
    language: p.language,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

/**
 * Set one key on `profile` (in place). `raw` is text as the user or tutor gave
 * it; `""`, `"null"` or `null` clears `interview_date` and `focus_topic`.
 */
export function setProfileValue(
  profile: ProfileRecord,
  key: string,
  raw: string | null,
  topics: readonly Topic[],
  languages: readonly Language[],
): void {
  let value: string | null = raw === null ? null : String(raw).trim();
  if (
    (key === 'interview_date' || key === 'focus_topic') &&
    (value === null || ['', 'null', 'none'].includes(value.toLowerCase()))
  )
    value = null;
  const oneOf = (allowed: readonly string[], name = key): string => {
    if (value === null || !allowed.includes(value))
      throw new TutorError(`${name} must be one of ${allowed.join(', ')}`);
    return value;
  };
  switch (key) {
    case 'goal':
      profile.goal = oneOf(PROFILE_CHOICES.goal);
      return;
    case 'experience':
      profile.experience = oneOf(PROFILE_CHOICES.experience);
      return;
    case 'hint_preference':
      profile.hintPreference = oneOf(PROFILE_CHOICES.hint_preference);
      return;
    case 'language':
      profile.language = oneOf(languages) as Language;
      return;
    case 'interview_date':
      if (value !== null && !validDate(value))
        throw new TutorError('interview_date must look like YYYY-MM-DD (or null)');
      profile.interviewDate = value;
      return;
    case 'focus_topic':
      if (value !== null && !topics.some((t) => t.id === value))
        throw new TutorError(
          `unknown topic "${value}"; topics: ${topics.map((t) => t.id).join(', ')}`,
        );
      profile.focusTopic = value;
      return;
  }
  if (key.startsWith('comfort.')) {
    const group = key.slice('comfort.'.length);
    const groups = topicGroups(topics);
    let targets: string[];
    if (group === 'all') targets = groups;
    else if (groups.includes(group)) targets = [group];
    else throw new TutorError(`unknown group "${group}"; groups: ${groups.join(', ')}`);
    const level = oneOf(COMFORT, 'comfort');
    profile.comfort = { ...profile.comfort };
    for (const g of targets) profile.comfort[g] = level;
    return;
  }
  throw new TutorError(`unknown profile key "${key}"; keys: ${PROFILE_KEYS}`);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
