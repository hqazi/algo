# Algorithm Tutor

A desktop app for practising data structures and algorithms with an AI tutor.
The problem, a code editor, a test runner and a tutor chat sit side by side.
It recommends what to practise next, runs your code against real tests, gives
hints one level at a time, reviews your solution and writes explanations.

> **Status: v1 release candidate.** Python practice, the tutor (Anthropic
> API or Claude Code), new problems and self-updating installers for macOS,
> Windows and Linux. Builds are not yet code-signed; see
> [Install](#install) for the extra step each OS asks for.

The successor to [`dsa-tutor`](https://github.com/hqazi/dsa-tutor), rebuilt to
be easy to install, configure and update:

- **One installer** for macOS, Windows and Linux. No Docker, Python or Node
  needed to practise in Python.
- **Settings in the app.** Paste your Anthropic API key once; it is kept in
  your OS keychain. Every setting applies without a restart.
- **Updates itself** from GitHub Releases. Your progress is kept in your user
  data folder and survives updates.
- **Honest feedback.** Pass or fail comes from running the tests, never from
  the model.
- **Sandboxed Python.** Your code, and any code the tutor writes, runs in a
  sandboxed in-app Python (Pyodide) with no file or network access.
- **Works without AI.** Browsing, editing, running, submitting and progress
  need no key; the tutor chat and making new problems do.
- **Python first.** Rust and Go (v2) run with your own toolchains or in a
  container; see below.

## Install

Download the file for your computer from the
[Releases page](https://github.com/hqazi/algorithm-tutor/releases):

| OS | File |
|---|---|
| macOS, Apple silicon (M1 and later) | `algorithm-tutor-<version>-mac-arm64.dmg` |
| macOS, Intel | `algorithm-tutor-<version>-mac-x64.dmg` |
| Windows 10 and 11 (x64) | `algorithm-tutor-<version>-win-x64.exe` |
| Linux x64, Debian or Ubuntu | `algorithm-tutor-<version>-linux-amd64.deb` |
| Linux x64, any distribution | `algorithm-tutor-<version>-linux-x86_64.AppImage` |

The `.zip`, `.blockmap` and `.yml` files on the same page are for the
updater; you do not need them. Nothing else has to be installed to practise
in Python.

**The builds are not code-signed yet**, so each OS warns the first time you
open the app. The steps below get past the warning once; after that the app
opens normally.

### macOS

1. Open the `.dmg` and drag **Algorithm Tutor** to **Applications**.
2. Open it from Applications. macOS says it cannot check the app for
   malicious software (or that it "is damaged"). Click **Done** (not *Move to
   Trash*).
3. Open **System Settings → Privacy & Security**, scroll to *Security*, and
   click **Open Anyway** next to the message about Algorithm Tutor. Confirm
   with your password.

If there is no **Open Anyway** button (or the app is reported as damaged),
remove the download quarantine in Terminal, then open the app again:

```sh
xattr -dr com.apple.quarantine "/Applications/Algorithm Tutor.app"
```

Unsigned macOS apps cannot update themselves: Settings → Updates tells you
when a new version is out; download it from the Releases page and replace the
app in Applications. Your progress is kept (see [Your data](#your-data-and-backups)).

### Windows

1. Run `algorithm-tutor-<version>-win-x64.exe`.
2. Windows SmartScreen says "Windows protected your PC". Click
   **More info**, then **Run anyway**.
3. The installer installs for your user only (no administrator rights) and
   lets you choose the folder. Open **Algorithm Tutor** from the Start menu.

Updates download in the background and install when you quit (or when you
click **Restart to update**).

### Linux

**Debian, Ubuntu and derivatives:**

```sh
sudo apt install ./algorithm-tutor-<version>-linux-amd64.deb
```

Then open **Algorithm Tutor** from your applications menu, or run
`algorithm-tutor`. Updating a `.deb` install asks for your password
(through `pkexec`); you can also install a newer `.deb` the same way.

**AppImage (any distribution):**

```sh
chmod +x algorithm-tutor-<version>-linux-x86_64.AppImage
./algorithm-tutor-<version>-linux-x86_64.AppImage
```

AppImages need FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04 and
later, `libfuse2` on older releases). An AppImage updates itself in place.
If it does not start, see [Troubleshooting](#troubleshooting).

## First run

1. **Welcome.** Five short questions: your goal, your experience, how
   comfortable you are with each area, whether you want hints early or to
   struggle first, and a topic to focus on. **Use defaults and start** skips
   them; you can change every answer later in **Settings → Profile**.
2. **Connect the tutor** (optional). Paste an Anthropic API key, or skip:
   everything except the tutor chat and making new problems works without
   one.
3. **Practice.** **Next problem** picks one for you. Edit the solution in the
   editor, **Run** (Ctrl+Enter, or Cmd+Enter on macOS) checks it against the
   visible tests, **Submit** runs every test and records the attempt.
   **Progress** shows your level per topic and your recent attempts.

Your solution is a plain file (shown in the practice view); you can edit it
in your own editor too, and the app reloads it when it changes on disk.

## Connecting the tutor

The tutor needs an [Anthropic API key](https://console.anthropic.com/settings/keys)
(usage is billed to your Anthropic account).

1. Open **Settings → Tutor**, paste the key into **Anthropic API key** and
   save. It is encrypted with your OS keychain (macOS Keychain, Windows
   DPAPI, the Secret Service on Linux) and shown back only as "ends in
   …abcd". **Test connection** makes one small request to check it.
2. Pick a **backend**:
   - **Automatic** (default) uses the Anthropic API when a key is set.
   - **Anthropic API** always uses it.
   - **Claude Code (with your API key)** uses your installed
     [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (2.1.328 or
     later) as the tutor, still with the API key above: the app cannot use a
     Claude subscription login. The app finds `claude` on your `PATH`, or you
     can give its path. Claude Code runs with all of its own tools off and
     only the tutor's tools on.
3. Optionally set the **model** and **effort**. The tutor chat then appears
   in the practice view with **Hint**, **Review** and **Explain**, and **New
   problem** can generate, paste or import problems.

If `ANTHROPIC_API_KEY` is set in the environment the app starts in, it is
used instead of a stored key and is read-only in Settings.

On Linux without a keyring (no GNOME Keyring or KWallet running), the key can
only be stored with weak protection; Settings warns you when that is the case.

## Your data and backups

Everything you make lives in one folder (**Settings → Data → Data folder**
shows it and opens it):

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/Algorithm Tutor` |
| Windows | `%APPDATA%\Algorithm Tutor` |
| Linux | `~/.config/Algorithm Tutor` |

It holds your progress and chats (`tutor.db`), settings (`settings.json`),
your solutions (`workspace/<problem>/solution.py`), the problems you made or
imported, and explanation pages. Updates and uninstalling never touch it.

- **Export…** (Settings → Data) writes a zip of all of it, except the API key.
  Keep one as a backup, or use it to move to another computer.
- **Import…** replaces your data with an export. The app makes an automatic
  backup first (into `backups/` in the data folder) and restarts to finish.
- **Reset progress** and **Reset everything** also make a backup first.
  *Reset everything* removes the stored key as well.

## Privacy: what the tutor sees

The app has no telemetry or analytics. Without the tutor it only goes online
to check GitHub Releases for updates (Settings → Updates can turn automatic
checks off) and, when you import from an open problem set, to fetch that set
from `raw.githubusercontent.com`. When you use the tutor chat, Hint, Review, Explain or
New problem, the app sends to Anthropic (directly, or through Claude Code):

- your messages and the conversation so far;
- the problem you are working on (statement, examples, visible tests) and
  its reference solution, when reviewing or explaining;
- your current solution file, when the tutor reads it;
- your test results (hidden tests only as pass/fail per category, never
  their inputs or expected outputs);
- your profile answers, topic levels and recent attempts;
- the text of a problem you paste or import.

It never sends your API key to the page, the code runner or Claude Code
(which gets a short-lived token for a relay inside the app), other files on
your computer, or your hidden test data. The tutor cannot write your code,
open files, run commands or reach the network. Python, including code the
tutor writes for new problems, runs in a sandboxed in-app Python with no file
or network access. The app log (`logs/` in the data folder) has no chat text
and no credentials. Anthropic's handling of API data is covered by its
[privacy policy](https://www.anthropic.com/legal/privacy).

## Optional: a container sandbox

*(v2.)* Rust and Go solutions run with your own `cargo` and `go` by default
(see [Installing Rust and Go](#installing-rust-and-go)): that is your own code
with your own permissions, like running it in a terminal. If you would rather
run them isolated (no network, no access to your files, limited memory and
processes), install a container runtime. The app never installs or starts
one; it finds what you have, and you choose it in
**Settings → Code execution**. Python always runs in the in-app sandbox and
needs none of this.

### Podman (recommended)

Free for everyone, runs without root, no background daemon.

- **macOS:**

  ```bash
  brew install podman
  ```
  ```bash
  podman machine init
  ```
  ```bash
  podman machine start
  ```

  Or install [Podman Desktop](https://podman-desktop.io/), which can create
  and start the machine for you. Run `podman machine start` again after a
  restart.
- **Windows:**

  ```bash
  winget install RedHat.Podman-Desktop
  ```

  Podman runs inside WSL2. If WSL2 is missing, run `wsl --install` from an
  administrator terminal and restart Windows. Then create and start the
  Podman machine from Podman Desktop, or with `podman machine init` and
  `podman machine start`.
- **Linux:** install the `podman` package; there is no machine to start.

  ```bash
  sudo apt install podman
  ```

  (Fedora: `sudo dnf install podman`; Arch: `sudo pacman -S podman`.)
  Memory limits need cgroup v2, the default on current distributions.

### Docker

- **macOS and Windows:** install
  [Docker Desktop](https://docs.docker.com/desktop/) and start it. Docker
  Desktop's licence requires a paid subscription for use at larger
  companies; check its terms.
- **Linux:** install [Docker Engine](https://docs.docker.com/engine/install/).
  To use it without `sudo`, add yourself to the `docker` group, then log out
  and back in (membership of that group is equivalent to root access):

  ```bash
  sudo usermod -aG docker "$USER"
  ```

The app honours `DOCKER_HOST` and the current Docker context.

### Other runtimes

[Colima](https://github.com/abiosoft/colima) and
[OrbStack](https://orbstack.dev/) on macOS provide the `docker` command and
are detected as Docker. Start them first (for example `colima start`).

### The runner image

Jobs run in the runner image `ghcr.io/hqazi/algorithm-tutor-runner`, tagged
with the app version, which has the Python, Rust and Go toolchains. The app
never downloads it on its own: press **Pull image** in
**Settings → Code execution** (once per runtime; Podman and Docker keep
separate image stores), and **Update image** after an app update.

> **Not published yet.** The image is built and published by CI in a later
> ticket (T19). Until then **Pull image** fails, and the container sandbox
> cannot be used; Rust and Go run with your local toolchains.

### Check that it works

Open **Settings → Code execution** and press **Recheck runtimes**. Each
runtime shows as not found (with a **How to install →** link here), installed
but not running (with the command that starts it, for example
`podman machine start`), or running. Choose a running runtime, pull the image,
then press **Test sandbox**: it builds and runs a hello world in Rust and in
Go inside that runtime's container, and never falls back to your local
toolchains.

## Installing Rust and Go

*(v2.)* Rust and Go are optional; Python needs nothing installed.

- **Rust:** install with [rustup](https://rustup.rs/), which provides
  `cargo`. On macOS and Linux:

  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```

  On Windows, run `rustup-init.exe` from the same site.
- **Go:** download the installer for your OS from
  [go.dev/dl](https://go.dev/dl/) and follow
  [go.dev/doc/install](https://go.dev/doc/install).

Open a new terminal and check that `cargo --version` and `go version` work.
Then restart the app, or press **Recheck runtimes** in
**Settings → Code execution**, and they show as found. With the
[container sandbox](#optional-a-container-sandbox) you do not need them
installed locally: the runner image has its own.

## Troubleshooting

- **The tutor says it is not set up, or "authentication failed".** Check the
  key in **Settings → Tutor → Test connection**. A key from
  `ANTHROPIC_API_KEY` wins over a stored one; unset it to use the stored key.
- **"Rate limited" or "network" errors in the chat.** Wait and send again; a
  stopped or failed reply never changes your progress. Check that
  `api.anthropic.com` is reachable from your network.
- **Claude Code is not offered.** Settings → Tutor shows where it looked and
  which version it found. It needs version 2.1.328 or later and an API key
  set in the app; give its full path if it is not on the `PATH` the app
  sees (apps started from the macOS Dock or a Linux menu may not see your
  shell's `PATH`).
- **Linux: the AppImage does not start** (on Ubuntu 24.04 and later the
  error mentions the sandbox or `chrome-sandbox`). Ubuntu restricts the
  user namespaces Electron's sandbox needs. Install the `.deb` instead, or
  allow them system-wide with
  `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (this
  lasts until reboot; it weakens a system protection, so prefer the `.deb`).
  Do not run the app with `--no-sandbox`. If the error is about FUSE,
  install `libfuse2t64` (or `libfuse2`), or run it with
  `--appimage-extract-and-run`.
- **Linux: Settings warns about weak key storage.** No keyring is running.
  Install and unlock GNOME Keyring or KWallet, or set `ANTHROPIC_API_KEY`.
- **macOS: "Algorithm Tutor is damaged and can't be opened".** The app is
  unsigned; run the `xattr` command under [macOS](#macos).
- **macOS: no automatic updates.** Expected for unsigned builds; download the
  new version from the Releases page.
- **Run takes long the first time.** The in-app Python starts on first use
  (a few seconds); later runs are quick. A solution that runs past the time
  limit is stopped and reported as a timeout.
- **My solution file changed under me.** The app reloads the solution file
  when another editor saves it. Undo in that editor, or use your own copy.
- **Something else.** The app log is in `logs/` in the data folder (it has
  no chat text or credentials); attach it to an
  [issue](https://github.com/hqazi/algorithm-tutor/issues). An export
  (Settings → Data) is a safe backup before you try anything drastic.

## Contributing

Work is split into tickets in [`docs/TASKS.md`](docs/TASKS.md); its Progress
table shows what is done and what is ready. [`CLAUDE.md`](CLAUDE.md) explains
how to pick one up.

Licensed under Apache 2.0.
