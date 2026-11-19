/**
 * Chat turns as the renderer receives them, ported from the recordings in
 * `dsa-tutor/web/tests/fixtures/chat/*.sse` (same scenarios and texts, in
 * this app's event shapes). Every event is parsed with the contract schema
 * by the fake bridge before the UI sees it.
 */
import type { ReportView } from '../../../shared/practice';
import type { ChatEventView } from '../../../shared/tutor';

export const SLUG = 'pair-with-target';

export const RUN_REPORT: ReportView = {
  slug: SLUG,
  language: 'python',
  passed: 0,
  total: 10,
  all_passed: false,
  cases: [
    {
      id: 'v1',
      visibility: 'visible',
      status: 'error',
      input: { amounts: '[1, 2]', target: '3' },
      expected: '[0, 1]',
      message: 'NotImplementedError',
      error_type: 'NotImplementedError',
    },
    { id: 'h1', visibility: 'hidden', category: 'large input', status: 'error' },
  ],
  duration_ms: 12,
};

export const CHAT_FIXTURES: Record<string, ChatEventView[]> = {
  'what-next': [
    { type: 'tool_start', id: 't1', name: 'next_problem', summary: 'Picking the next problem' },
    { type: 'tool_end', id: 't1', ok: true, summary: 'Next: pair-with-target' },
    { type: 'ui_event', event: { type: 'ui', action: 'refresh_state' } },
    { type: 'tool_start', id: 't2', name: 'start_problem', summary: 'Opening the problem' },
    { type: 'tool_end', id: 't2', ok: true, summary: 'Opened pair-with-target' },
    { type: 'ui_event', event: { type: 'ui', action: 'open_problem', slug: SLUG } },
    { type: 'ui_event', event: { type: 'ui', action: 'refresh_state' } },
    { type: 'text_delta', text: 'Here is your next one: **Two Receipts**. ' },
    { type: 'text_delta', text: 'It is in your focus topic.' },
    { type: 'done', stop: 'end_turn' },
  ],
  hint: [
    { type: 'tool_start', id: 't1', name: 'read_solution', summary: 'Reading your code' },
    { type: 'tool_end', id: 't1', ok: true, summary: 'Read your code' },
    { type: 'tool_start', id: 't2', name: 'take_hint', summary: 'Picking the hint level' },
    { type: 'tool_end', id: 't2', ok: true, summary: 'Hint level 1 of 4' },
    { type: 'ui_event', event: { type: 'ui', action: 'refresh_state' } },
    { type: 'text_delta', text: 'Here is a nudge: think about *runs*.\n\n' },
    { type: 'text_delta', text: '```python\nfor ch in s:\n    ...\n```\n' },
    {
      type: 'text_delta',
      text: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>',
    },
    { type: 'text_delta', text: '[click](javascript:alert(1))' },
    { type: 'done', stop: 'end_turn' },
  ],
  'run-tests': [
    { type: 'tool_start', id: 't1', name: 'run_tests', summary: 'Running tests' },
    { type: 'tool_end', id: 't1', ok: true, summary: '0/10 passed' },
    {
      type: 'ui_event',
      event: { type: 'ui', action: 'show_results', slug: SLUG, report: RUN_REPORT },
    },
    { type: 'text_delta', text: 'Not yet: some cases fail.' },
    { type: 'done', stop: 'end_turn' },
  ],
  explain: [
    {
      type: 'tool_start',
      id: 't1',
      name: 'render_explanation',
      summary: 'Writing the explanation',
    },
    { type: 'tool_end', id: 't1', ok: true, summary: 'Explanation ready' },
    { type: 'ui_event', event: { type: 'ui', action: 'open_explanation', slug: SLUG } },
    { type: 'ui_event', event: { type: 'ui', action: 'refresh_state' } },
    { type: 'text_delta', text: 'The explanation is open.' },
    { type: 'done', stop: 'end_turn' },
  ],
  'tool-failed': [
    { type: 'tool_start', id: 't1', name: 'get_problem', summary: 'Reading the problem' },
    { type: 'tool_end', id: 't1', ok: false, summary: 'no problem with slug "nope"' },
    { type: 'text_delta', text: 'I could not find that problem.' },
    { type: 'done', stop: 'end_turn' },
  ],
  refusal: [
    {
      type: 'error',
      kind: 'refusal',
      message: 'The tutor declined to answer this. Try rephrasing the request.',
    },
  ],
  'rate-limit': [
    { type: 'text_delta', text: 'Let me' },
    {
      type: 'error',
      kind: 'rate_limit',
      message: 'The Anthropic API rate limit was reached. Wait a minute and try again.',
    },
  ],
  auth: [
    {
      type: 'error',
      kind: 'auth',
      message:
        'The Anthropic API rejected the API key. Check the key and its permissions in Settings.',
    },
  ],
  cancelled: [{ type: 'text_delta', text: 'Thinking about' }],
};
