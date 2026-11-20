# Installation

Algo is one installer per operating system. Nothing else has to be
installed to practise in Python: no Python, Node or Docker.

## Download

Download the file for your computer from the
[Releases page](https://github.com/hqazi/algo/releases):

| OS | File |
|---|---|
| macOS, Apple silicon (M1 and later) | `algo-<version>-mac-arm64.dmg` |
| macOS, Intel | `algo-<version>-mac-x64.dmg` |
| Windows 10 and 11 (x64) | `algo-<version>-win-x64.exe` |
| Linux x64, Debian or Ubuntu | `algo-<version>-linux-amd64.deb` |
| Linux x64, any distribution | `algo-<version>-linux-x86_64.AppImage` |

The `.zip`, `.blockmap` and `.yml` files on the same page are for the
updater; you do not need them.

> [!IMPORTANT]
> **The builds are not code-signed yet**, so each OS warns the first time you
> open the app. The steps below get past the warning once; after that the app
> opens normally.

## macOS

1. Open the `.dmg` and drag **Algo** to **Applications**.
2. Open it from Applications. macOS says it cannot check the app for
   malicious software (or that it "is damaged"). Click **Done** (not *Move to
   Trash*).
3. Open **System Settings → Privacy & Security**, scroll to *Security*, and
   click **Open Anyway** next to the message about Algo. Confirm
   with your password.

If there is no **Open Anyway** button (or the app is reported as damaged),
remove the download quarantine in Terminal, then open the app again:

```sh
xattr -dr com.apple.quarantine "/Applications/Algo.app"
```

## Windows

1. Run `algo-<version>-win-x64.exe`.
2. Windows SmartScreen says "Windows protected your PC". Click
   **More info**, then **Run anyway**.
3. The installer installs for your user only (no administrator rights) and
   lets you choose the folder. Open **Algo** from the Start menu.

## Linux

**Debian, Ubuntu and derivatives:**

```sh
sudo apt install ./algo-<version>-linux-amd64.deb
```

Then open **Algo** from your applications menu, or run
`algo`.

**AppImage (any distribution):**

```sh
chmod +x algo-<version>-linux-x86_64.AppImage
```

```sh
./algo-<version>-linux-x86_64.AppImage
```

AppImages need FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04 and
later, `libfuse2` on older releases). If it does not start, see
[Troubleshooting](troubleshooting.md#linux-the-appimage-does-not-start).

## Updates

The app checks GitHub Releases for new versions (**Settings → Updates** can
turn automatic checks off or switch to the `beta` channel). Your progress is
kept in your [data folder](data-and-privacy.md#your-data-folder) and survives
every update.

| Install | How it updates |
|---|---|
| Windows | Downloads in the background and installs when you quit, or when you click **Restart to update**. |
| Linux AppImage | Updates itself in place. |
| Linux `.deb` | Downloads the new `.deb` and asks for your password (through `pkexec`). You can also install a newer `.deb` with `apt` as above. |
| macOS (unsigned) | Cannot update itself. Settings → Updates tells you when a new version is out; download it from the Releases page and replace the app in Applications. |

## Next

[Get started →](getting-started.md)
