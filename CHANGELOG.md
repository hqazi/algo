# Changelog

All notable changes to Algo. Versions follow
[semantic versioning](https://semver.org); tags `vX.Y.Z-beta.N` are beta
releases and `vX.Y.Z-rc.N` release candidates (draft test releases).

## 0.1.0 (unreleased; release candidates `v0.1.0-rc.N`)

First version of the desktop app, the successor to
[`dsa-tutor`](https://github.com/hqazi/dsa-tutor).

- Installers for macOS (dmg and zip, Apple silicon and Intel), Windows (NSIS,
  x64) and Linux (AppImage and deb, x64). Not code-signed yet; the README
  says how to open them.
- Updates from GitHub Releases: `stable` and `beta` channels, background
  download, install on quit, "Restart to update" (not on unsigned macOS
  builds).
- Onboarding questions, a recommender for the next problem, an editor that
  follows the solution file on disk, Run (visible tests), Submit (all tests,
  hidden ones by category), levels per topic and recent attempts.
- 50 curated Python problems with references; Python runs in a sandboxed,
  network-blocked Pyodide.
- The tutor, with the Anthropic API or Claude Code (with your API key):
  chat, hints one level at a time, reviews that run the tests, explanation
  pages, generated, pasted and imported problems (each passes a self-check).
- Settings for the tutor (key in the OS keychain), code execution, profile,
  appearance and editor, data (export, import, reset with automatic
  backups) and updates. Every setting applies without a restart.
- Rust and Go (v2 preview): with your own `cargo` and `go`, or in a Docker
  or Podman container.
- The Library (v3): read Markdown folders or an Obsidian vault offline, with
  local and linked images (downloaded once, safely, and cached), chats tied
  to passages, problems made from a passage, and articles written by the
  tutor.
- A new logo and app icon; the README is a front page and the user guide
  lives in [`docs/guide/`](docs/guide/installation.md).
- Collapsible panes: on Practice and Library the side panes fold into a
  thin rail and the test results to their summary line, remembered per
  page. Shortcuts: Ctrl/Cmd+J for the results, Ctrl/Cmd+1–3 and F6 to
  move between panes.
- A tmux-style leader key (Ctrl+B by default; Ctrl+A, Ctrl+Space or off in
  Settings): the leader, then `[` `]` to hide the side panes, `z` to hide
  both, `h` `l` `o` `1`–`3` to move between panes, `t` `j` `k` `r` `s` for
  the tests, editor, Run and Submit, and `?` for the list.
- Read aloud in the Library, with Kokoro, an open-source neural voice that
  runs on your computer (downloaded once, 324 MB, on first use; on the CPU,
  or the GPU if you turn it on in Settings): the paragraph being read highlighted; pause, skip,
  speed and 28 English voices (leader `p` `n` `b` `x`). Nothing you read
  leaves the computer.
