# Algo: visual design

The target look for the UI refresh (tickets T28–T34 in [`TASKS.md`](TASKS.md)).
It changes how the app looks and feels, not what it does: every flow in
[`SPEC.md`](SPEC.md) §8 and §15.6 stays. Where a ticket needs a choice this
page does not make, make it in the spirit below and record it in
`DECISIONS.md`.

## Principles

- **Quiet, then clear.** Neutral surfaces, one accent colour, colour used
  for meaning (pass, fail, warning, difficulty), not decoration.
- **Hierarchy through weight, not borders.** One primary action per area.
  Fewer boxes: panes meet at 1px dividers; cards lift with a soft shadow
  instead of a border where they sit on the page background.
- **A desktop app, not a web page.** No native-looking widgets showing
  through (selects, radios, scrollbars, resize grips, disclosure triangles).
  The navigation lives in the window's title bar.
- **Same names, same behaviour.** Buttons keep their accessible names
  (icon-only buttons get `aria-label` and a tooltip) so keyboard use, tests
  and the user guide still hold. Keyboard shortcuts stay.
- **Both themes are first-class.** Every change is checked in light and dark.
  Text meets WCAG AA contrast (4.5:1 body, 3:1 large text and UI parts).

## Foundations (T28)

### Colour

Neutral greys (a zinc-like scale, slightly cool, not the current warm
`#f7f7f5`) and one accent, indigo. Tokens keep their names where they exist
(`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, ...) so
existing CSS keeps working; add what is missing:

| Token | Use |
|---|---|
| `--bg` | Window background behind panes and pages |
| `--surface`, `--surface-2`, `--surface-3` | Panes and cards; subtle fills (hover, code); pressed or selected |
| `--border`, `--border-strong` | Dividers; input borders and focus-adjacent edges |
| `--text`, `--muted`, `--faint` | Body; secondary; placeholders and disabled |
| `--accent`, `--accent-hover`, `--accent-subtle`, `--accent-text` | Primary buttons and selection; their hover; tinted backgrounds (active nav, user bubbles, selected rows); text on accent |
| `--accent-fg` | The accent as text or an icon on a surface (links, the open Library article); lighter than `--accent` in dark mode so it stays readable |
| `--accent-disabled` | Fill of a disabled primary button (shown at 55% opacity): the accent in light mode, a brighter indigo in dark mode so it does not turn muddy |
| `--focus` | The focus ring (2px outline, 2px offset); lighter in dark mode so it keeps 3:1 |
| `--accent-ring` | The soft 3px ring around a focused input, select or the code editor |
| `--pass`, `--fail`, `--warn` and `-bg` variants | Test results, statuses, difficulty |
| `--easy`, `--medium`, `--hard` | Difficulty dots and text |

Dark mode uses a deep accent with white text on primary buttons (not the
current pastel blue with dark text). Submit is no longer green: green means
"passed" only.

### Type

- Bundle **Inter** (variable) and **JetBrains Mono** (variable) with the app
  (npm `@fontsource-variable/*`, OFL-1.1); no remote fonts. Their licences go
  into the third-party notices and Settings → About.
- Base 14px for app chrome, 15px for statements and chat, 16–17px with a
  ~70ch measure for the Library reader.
- Scale: page title 22–24px / 600 / letter-spacing −0.01em; pane title
  13px / 600; section label 11–12px uppercase / 600 / `--muted` /
  letter-spacing 0.04em. Numbers in stats and timings use
  `font-variant-numeric: tabular-nums`.

### Shape, depth, motion

- Radius scale `--radius-sm` 6px (inputs, chips), `--radius` 10px (cards,
  menus), `--radius-lg` 14px (dialogs).
- Shadows `--shadow-sm` (cards), `--shadow` (menus, popovers),
  `--shadow-lg` (dialogs). Dialog backdrop dims and blurs slightly.
- Transitions 120–160ms ease-out on colour, background, border and
  shadow; respect `prefers-reduced-motion`.
- Spacing on a 4px grid.

### Icons

`lucide-react` (ISC), 16px in buttons and nav, stroke 1.75. Icons support
labels; icon-only buttons are reserved for compact toolbars (pane headers,
chat actions) and always have `aria-label` plus `title`.

### Controls

- **Buttons:** `primary` (filled accent), `secondary` (surface + border),
  `ghost` (no border, hover fill), `danger`, `icon` (square ghost). Sizes
  `sm` (28px), default (32px), `lg` (40px). Disabled primary keeps its
  colour at reduced opacity (`--accent-disabled` at 55%), not a washed-out
  tint.
- **Inputs, selects, textareas:** one height (32px), `--radius-sm`,
  `--border-strong` on hover, accent ring on focus. Selects use
  `appearance: none` with a chevron.
- **Segmented control** for 2–4 exclusive options (tabs in dialogs, theme,
  "This problem / General").
- **Choice cards** for onboarding questions (radio semantics kept).
- **Scrollbars:** thin, overlay-style, thumb shows on hover.
- **Text boxes** that take messages grow with their content (up to a cap)
  instead of showing a resize grip.
- **Pills/badges:** small (20px), tinted background, no border.
- **Menu** (popover) for overflow actions, keyboard accessible; the
  focused item shows a filled row, not an outline.
- **Focus.** Every control shows `--focus` as a 2px outline when reached by
  keyboard; text fields (inputs, selects, the code editor, the chat
  composer) show `--accent-ring` instead. In the editor, Tab indents;
  Escape then Tab moves on.

### Editor

CodeMirror themes match the tokens: editor background = pane background,
gutter without a separate border, active line a faint accent tint,
JetBrains Mono.

## App frame (T29)

- The title bar holds the navigation: macOS `titleBarStyle: 'hiddenInset'`
  (nav starts after the traffic lights), Windows and Linux
  `titleBarOverlay` matching the theme. The bar is draggable except its
  controls.
- Left: logo mark + **Algo**. Centre-left: nav links with icons (Home,
  Problems, Progress, Library, Settings); the active one shows a subtle
  filled pill or underline, never a button look. Right: **New problem**
  (secondary), **Next problem** (primary), tutor status (a coloured dot and
  "Tutor", with the backend in its tooltip).
- During onboarding the nav and actions are hidden.
- Multi-pane pages (Practice, Library) are edge to edge: panes on
  `--surface`, separated by 1px dividers that are the resize handles
  (wider hit area, accent on hover/drag). Each pane has a header of one
  height (40–44px) with its title and its actions as ghost or icon buttons.
- **Collapsing (T35).** The side panes end their header with a panel icon
  button that folds the pane into a 36px rail (`--pane-rail-w`): the
  open-panel icon and the title written top to bottom, the whole rail a
  button. The pane stays mounted, so drafts survive. The divider beside a
  rail is a plain line. On Practice the results fold to their first line
  (summary or note) with a panel-bottom icon button at its end. Shortcuts:
  Ctrl/Cmd+J results, Ctrl/Cmd+1–3 and F6/Shift+F6 to move between panes;
  the rest are behind the leader key.
- **Leader key (T36).** tmux-style: the leader (Ctrl+B by default,
  `ui.leader`), then one key. While waiting, a chip at the bottom centre
  (surface, `--shadow-lg`, the leader as a `kbd`) says so. Leader `?` opens
  a dialog listing the actions by group, keys as `kbd` caps.
- **Narrow windows.** Under 1100px the nav shows icons only (names in the
  tooltip). Under 900px multi-pane pages show one pane at a time with tabs
  above; switching layouts keeps each pane's state. The window's minimum
  size is 800×600 (`MIN_WINDOW_SIZE` in `main/window.ts`).

## Pages

### Practice (T30)

- **Statement:** title, then difficulty, topic and status as small pills.
  Examples as code blocks on `--surface-2`. Constraints and target in a
  quiet "Details" block.
- **Editor toolbar:** language select (styled), save state as a faint
  status, then on the right **Run** (secondary, ▶ icon, shortcut in
  tooltip) and **Submit** (primary). **Give up** and **Reset** move into a
  "More" menu (`…`), still reachable by name.
- **Results:** a summary bar that stays at the top of the results pane
  ("10/11 passed", coloured, with the run kind and time). Passing tests
  collapse to one line; failing ones open by default and show input,
  expected and got as a compact diff-style grid. Hidden-test categories
  read as plain sentences.
- **Tutor pane:** header with a segmented "This problem / General" and a
  **New chat** icon button. User messages as accent-subtle bubbles on the
  right; tutor messages unboxed on the left; action tags ("Hint",
  "Read your code") as small faint chips. **Hint**, **Review**, **Explain**
  as chips above the composer; the composer is one rounded box that grows,
  with the send icon button inside it.

### Home, Problems, Progress (T31)

- **Home** becomes a dashboard: a "Continue" card for the problem in
  progress (title, topic, when it was started, **Resume**), a "Recommended next"
  card (the next-problem pick with its reason), a compact progress summary
  (topics comfortable / learning / not started, problems solved), and the
  tutor chat as a card below. Empty states have an icon and one line.
- **Problems:** a toolbar with search (icon inside) and filters as styled
  selects or chips with counts. Table rows are fully clickable, with a hover
  fill; titles in `--text`, weight 500, no underline. Status as an icon
  (empty circle new, half circle in progress, check solved), difficulty as a
  coloured dot + word. The Source column shows only when more than one
  source is present. Header sticks while scrolling.
- **Progress:** a summary row of stat tiles (comfortable, learning, not
  started, solved). Topic groups as cards in a balanced grid; each topic is
  one compact row: name, level badge, a single segmented bar (unaided /
  with help / tried), and counts shown only when non-zero. Active problems
  and recent attempts are tables on cards, by problem title, with relative
  times.

### Library (T32)

- **Tree:** chevrons and folder/file icons, indented guides, the selected
  article as an accent-subtle row. Header with the filter box and icon
  buttons for **Refresh** and **Write an article**.
- **Reader:** 16–17px body, ~70ch measure, generous line height. Source as
  the domain with an external-link icon. Tags as pills. Callouts with an
  icon and a tinted background. The per-heading **Ask** button shows on
  hover/focus only. Thread markers in the margin use the accent.
- **Chats pane:** thread list with title, passage snippet and relative time
  ("2 min ago", full date in a tooltip); the open thread's **Rename**,
  **New chat**, **Close** as icon buttons; the same message and composer
  styles as Practice.

### Onboarding, Settings, dialogs (T33)

- **Onboarding:** a centred stepper, one question per step, choice cards,
  a step indicator, **Back** / **Continue**, and **Use defaults and start**
  kept as a secondary action on every step.
- **Onboarding as built:** the last step's button is **Save and continue**
  (not Continue); **Use defaults and start** is a ghost button.
- **Settings:** a left section list (Tutor, Code execution, Appearance,
  Library, Profile, Data, Updates, About) with scroll-spy: every section
  stays on one page and the list follows the scroll position (under 900px
  the list wraps above the sections); form rows aligned (label left,
  control, help text under it); status lines as a status dot + text, not raw
  "On · fake · fake-model".
- **Dialogs:** `--radius-lg`, `--shadow-lg`, a header with title and close
  icon, footer actions right-aligned. New problem's Generate / Paste /
  Import as a segmented control; difficulty labels capitalised. The
  explanation dialog shows the problem title, not its slug.
- **Toasts:** bottom-right, surface with shadow, an icon per kind.
- **Dates:** relative for recent ("2 min ago", "yesterday"), absolute in a
  tooltip, one shared formatter (`relativeDate` / `fullDate` in
  `lib/format.ts`, `components/RelativeTime.tsx`): Home, Progress, the
  explanation versions, the Library chats and Settings → Updates.
- **Give up and Reference** on Practice use the shared dialog too (close
  icon, footer actions on the right).

## Checking

`npm run screenshots` takes practice, explanation, home, problems,
progress, settings, library and practice-dark at 1440×880. A UI change
retakes them (or uses a scratch copy of the script for screens it does not
cover) and looks at the changed screens in light and dark, at 1440×880 and
at the minimum window size, before it is done.
