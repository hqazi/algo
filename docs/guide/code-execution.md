# Code execution

Every Run and Submit runs your code against real tests. How it runs depends on
the language.

| Language | Runs in | Needs |
|---|---|---|
| **Python** | A sandboxed in-app Python ([Pyodide](https://pyodide.org)) with no file or network access. | Nothing. |
| **Rust** | Your own `cargo`, or a container. | [Rust](#installing-rust-and-go), or a [container runtime](#optional-a-container-sandbox). |
| **Go** | Your own `go`, or a container. | [Go](#installing-rust-and-go), or a [container runtime](#optional-a-container-sandbox). |

Choose the language for a problem in the practice view's language menu. A
language that cannot run on your computer is shown as *not installed*, with
the reason.

Python is always sandboxed, including any code the tutor writes. The first
run after the app starts takes a few seconds while the in-app Python loads;
later runs are quick. A solution that runs past the time limit is stopped and
reported as a timeout.

## Installing Rust and Go

Rust and Go are optional; Python needs nothing installed.

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

> [!NOTE]
> With your own toolchains, Rust and Go solutions run as your own code with
> your own permissions, like running them in a terminal. Use the container
> sandbox if you want them isolated.

## Optional: a container sandbox

If you would rather run Rust and Go isolated (no network, no access to your
files, limited memory and processes), install a container runtime. The app
never installs or starts one; it finds what you have, and you choose it in
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

Jobs run in the runner image `ghcr.io/hqazi/algo-runner`, tagged
with the app version, which has the Python, Rust and Go toolchains. The app
never downloads it on its own: press **Pull image** in
**Settings → Code execution** (once per runtime; Podman and Docker keep
separate image stores), and **Update image** after an app update.

The image is published for `linux/amd64` and `linux/arm64` (Docker and
Podman pick the right one, including on Apple silicon and Windows on Arm).
Each release tag publishes the matching version, and stable versions also
move `latest`.

### Check that it works

Open **Settings → Code execution** and press **Recheck runtimes**. Each
runtime shows as not found (with a **How to install →** link here), installed
but not running (with the command that starts it, for example
`podman machine start`), or running. Choose a running runtime, pull the image,
then press **Test sandbox**: it builds and runs a hello world in Rust and in
Go inside that runtime's container, and never falls back to your local
toolchains.
