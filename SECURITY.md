# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it
privately through
[GitHub's private vulnerability reporting](https://github.com/hqazi/algo/security/advisories/new)
with the version, your OS, and steps to reproduce.

Fixes go into the latest release; the app updates itself (see
[Updates](docs/guide/installation.md#updates)).

## The security model, in short

Algo runs code you write, code an AI model writes, and Markdown
articles from the web. It is built so that none of these can reach your files,
your network or your API key. The full threat table is in
[SPEC §10](docs/SPEC.md#10-security); the main lines are:

- **Python runs in Pyodide** inside a hidden, sandboxed, network-blocked
  window. Code the model writes runs only there.
- **Rust and Go** run with your own toolchains (your own code, your own
  permissions, as in a terminal) or, if you choose, in a locked-down container
  with no network.
- **The UI is sandboxed**: context isolation, no Node integration, a strict
  Content Security Policy, the app's own protocol, every outside request
  cancelled, navigation and new windows blocked, Electron fuses set.
- **The API key** is stored with the OS keychain and stays in the main
  process. Claude Code, when used, gets only a short-lived token for a local
  relay.
- **The tutor has a fixed set of tools**: none writes your code, opens
  arbitrary files, runs commands or reaches the network. Pasted problems and
  articles are passed to it as delimited untrusted data.
- **Hidden tests** never leave the main process; the UI and the tutor see only
  a category and pass or fail.
- **Library articles** are rendered with raw HTML dropped and a sanitiser
  allowlist. Images are served by the main process from inside your chosen
  folders only, or downloaded by it over `https` with every address checked
  against local-network ranges. Chat replies never render images.

## Things that are expected

- The builds are **not code-signed yet**; your OS warns the first time you
  open the app ([Installation](docs/guide/installation.md)).
- Rust and Go **without a container** run as your own user, with your
  permissions.
