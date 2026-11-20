# Troubleshooting

## The tutor

**The tutor says it is not set up, or "authentication failed".**
Check the key in **Settings → Tutor → Test connection**. A key from
`ANTHROPIC_API_KEY` wins over a stored one; unset it to use the stored key.

**"Rate limited" or "network" errors in the chat.**
Wait and send again; a stopped or failed reply never changes your progress.
Check that `api.anthropic.com` is reachable from your network.

**Claude Code is not offered.**
Settings → Tutor shows where it looked and which version it found. It needs
version 2.1.328 or later and an API key set in the app. Give its full path if
it is not on the `PATH` the app sees (apps started from the macOS Dock or a
Linux menu may not see your shell's `PATH`).

## Installing and starting

### Linux: the AppImage does not start

On Ubuntu 24.04 and later the error mentions the sandbox or
`chrome-sandbox`: Ubuntu restricts the user namespaces Electron's sandbox
needs. Install the `.deb` instead, or allow them system-wide with
`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (this lasts
until reboot; it weakens a system protection, so prefer the `.deb`). Do not
run the app with `--no-sandbox`.

If the error is about FUSE, install `libfuse2t64` (or `libfuse2`), or run it
with `--appimage-extract-and-run`.

### Linux: Settings warns about weak key storage

No keyring is running. Install and unlock GNOME Keyring or KWallet, or set
`ANTHROPIC_API_KEY`.

### macOS: "Algo is damaged and can't be opened"

The app is unsigned; run the `xattr` command under
[Installation → macOS](installation.md#macos).

### macOS: no automatic updates

Expected for unsigned builds; download the new version from the
[Releases page](https://github.com/hqazi/algo/releases).

## Practising

**Run takes long the first time.**
The in-app Python starts on first use (a few seconds); later runs are quick.
A solution that runs past the time limit is stopped and reported as a
timeout.

**My solution file changed under me.**
The app reloads the solution file when another editor saves it. Undo in that
editor, or use your own copy.

**Rust or Go shows as "not installed".**
See [Installing Rust and Go](code-execution.md#installing-rust-and-go), then
press **Recheck runtimes** in **Settings → Code execution**.

## The Library

**An article is missing.**
Files in hidden folders (`.obsidian`, `.trash`, ...) and files over 5 MB are
skipped. Press **Refresh** in the Library.

**An image shows a placeholder.**
The placeholder says why: for example an `http:` link (only `https` images
are downloaded), a link to a local network address, a file that is too large,
or a site that did not answer. **Retry** tries again.

## Something else

The app log is in `logs/` in the [data folder](data-and-privacy.md#your-data-folder)
(it has no chat text or credentials); attach it to an
[issue](https://github.com/hqazi/algo/issues/new/choose). An export
(Settings → Data) is a safe backup before you try anything drastic.
