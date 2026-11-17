# Algorithm Tutor

A desktop app for practising data structures and algorithms with an AI tutor.
The problem, a code editor, a test runner and a tutor chat sit side by side.
It recommends what to practise next, runs your code against real tests, gives
hints one level at a time, reviews your solution and writes explanations.

> **Status: planning.** There is no app to install yet. The design is in
> [`docs/SPEC.md`](docs/SPEC.md) and the work plan in
> [`docs/TASKS.md`](docs/TASKS.md). This README describes the intended
> behaviour and is completed in ticket T14.

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
- **Python first.** Rust and Go are planned (v2).

## Install

*(Available once v1 is released.)* Download the installer for your OS from the
[Releases page](https://github.com/hqazi/algorithm-tutor/releases), run it,
and open **Algorithm Tutor**. The first run asks five short questions about
your goals (or skip them) and offers to connect the tutor.

## Optional: a container sandbox

*(v2.)* Rust and Go solutions run with your own `cargo` and `go` by default:
that is your own code with your own permissions, like running it in a
terminal. If you would rather run them isolated (no network, no access to your
files), install a container runtime. The app never installs one; it finds what
you have, and you choose it in **Settings → Code execution**.

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

  Or install [Podman Desktop](https://podman-desktop.io/).
- **Windows:**

  ```bash
  winget install RedHat.Podman-Desktop
  ```

  Podman needs WSL2. If it is missing, run `wsl --install` from an
  administrator terminal and restart Windows.
- **Linux:** install the `podman` package (`sudo apt install podman`,
  `sudo dnf install podman` or `sudo pacman -S podman`).

### Docker

- **macOS and Windows:** [Docker Desktop](https://docs.docker.com/desktop/).
  Docker Desktop's licence requires a paid subscription for use at larger
  companies; check its terms.
- **Linux:** [Docker Engine](https://docs.docker.com/engine/install/). To
  use it without `sudo`, add yourself to the `docker` group, then log out and
  back in:

  ```bash
  sudo usermod -aG docker "$USER"
  ```

### Other runtimes

[Colima](https://github.com/abiosoft/colima) and
[OrbStack](https://orbstack.dev/) on macOS provide the `docker` command and
are detected as Docker.

### Check that it works

Open **Settings → Code execution**, press **Recheck**, choose the runtime,
then press **Test sandbox**. If the runtime is installed but not running, the
app shows the command that starts it (for example `podman machine start`).

## Installing Rust and Go

*(v2.)* Install Rust with [rustup](https://rustup.rs/) and Go from
[go.dev/dl](https://go.dev/dl/). Restart the app (or press **Recheck**) and
they appear in **Settings → Code execution**.

## Contributing

Work is split into tickets in [`docs/TASKS.md`](docs/TASKS.md); its Progress
table shows what is done and what is ready. [`CLAUDE.md`](CLAUDE.md) explains
how to pick one up.

Licensed under Apache 2.0.
