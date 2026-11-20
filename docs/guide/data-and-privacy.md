# Your data and privacy

## Your data folder

Everything you make lives in one folder (**Settings → Data → Data folder**
shows it and opens it):

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/Algo` |
| Windows | `%APPDATA%\Algo` |
| Linux | `~/.config/Algo` |

It holds your progress and chats (`tutor.db`), settings (`settings.json`),
your solutions (`workspace/<problem>/solution.py`), the problems you made or
imported, explanation pages and articles the tutor wrote. Updates and
uninstalling never touch it.

Your Library folders stay where they are; the app only reads them. Images it
downloads for articles are kept in a cache inside the data folder.

## Export, import and reset

In **Settings → Data**:

- **Export…** writes a zip of your data, except the API key and the image
  cache. Keep one as a backup, or use it to move to another computer.
- **Import…** replaces your data with an export. The app makes an automatic
  backup first (into `backups/` in the data folder) and restarts to finish.
- **Reset progress** and **Reset everything** also make a backup first.
  *Reset everything* removes the stored key as well.

## Privacy: what the tutor sees

The app has no telemetry or analytics. Without the tutor it goes online only
to:

- check GitHub Releases for updates (**Settings → Updates** can turn
  automatic checks off);
- fetch an open problem set from `raw.githubusercontent.com`, when you import
  from one;
- download images that articles in your Library link to (see
  [The Library](library.md#reading)).

When you use the tutor chat, Hint, Review, Explain, New problem or a Library
chat, the app sends to Anthropic (directly, or through Claude Code):

- your messages and the conversation so far;
- the problem you are working on (statement, examples, visible tests) and
  its reference solution, when reviewing or explaining;
- your current solution file, when the tutor reads it;
- your test results (hidden tests only as pass/fail per category, never
  their inputs or expected outputs);
- your profile answers, topic levels and recent attempts;
- the text of a problem you paste or import;
- in a Library chat: the article's title, source and outline, the section you
  asked about, and any other section the tutor reads or searches.

It never sends your API key to the page, the code runner or Claude Code
(which gets a short-lived token for a relay inside the app), other files on
your computer, or your hidden test data. The tutor cannot write your code,
open files, run commands or reach the network. Python, including code the
tutor writes for new problems, runs in a sandboxed in-app Python with no file
or network access.

The app log (`logs/` in the data folder) has no chat text and no
credentials. Anthropic's handling of API data is covered by its
[privacy policy](https://www.anthropic.com/legal/privacy).
