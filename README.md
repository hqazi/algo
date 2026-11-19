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

## Contributing

Work is split into tickets in [`docs/TASKS.md`](docs/TASKS.md); its Progress
table shows what is done and what is ready. [`CLAUDE.md`](CLAUDE.md) explains
how to pick one up.

Licensed under Apache 2.0.
