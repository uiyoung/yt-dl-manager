# YT Download Manager

A desktop app for downloading YouTube videos and keeping track of them.
Paste links, choose a quality, and manage your downloads in one place.

## Features

- Paste many links at once: videos, playlists and bare video IDs.
- Pick a quality for each video from the qualities it actually offers.
- Queue downloads and start, stop or retry them, one at a time or in bulk.
- Cut a section from a video before downloading it, or from a file you already downloaded.
- Search and sort finished downloads, then play, move or remove them.

## Requirements

The app does not bundle any download tools. Install these yourself and make sure they are on your `PATH`:

| Tool                                               | Why                                       |
| -------------------------------------------------- | ----------------------------------------- |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp)         | Downloads videos and reads video info     |
| [ffmpeg](https://ffmpeg.org/) (includes `ffprobe`) | Merges video and audio, and cuts sections |
| [Deno](https://deno.com/) (recommended)            | yt-dlp uses it to handle YouTube          |

macOS (Homebrew):

```bash
brew install yt-dlp ffmpeg deno
```

Windows (winget):

```bash
winget install yt-dlp.yt-dlp Gyan.FFmpeg DenoLand.Deno
```

The app looks in your `PATH` first, then in common install folders (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.deno/bin`, `~/.local/bin`). Settings shows which versions it found.

To update the tools, use the same installer you used to install them, for example `brew upgrade yt-dlp`.

## Development setup

You need:

- [Node.js](https://nodejs.org/) 20 or later
- [Rust](https://rustup.rs/) (stable)
- The Tauri prerequisites for your OS: <https://tauri.app/start/prerequisites/>

Install the JavaScript dependencies:

```bash
npm install
```

## Run

Start the app in development mode, with hot reload:

```bash
npm run tauri dev
```

## Build

Build a release app and installer:

```bash
npm run tauri build
```

The output goes to `src-tauri/target/release/bundle/`, for example a `.app` and `.dmg` on macOS.

## Tests

```bash
cd src-tauri && cargo test
```

## Where data is stored

|               | macOS                                               | Windows                                       |
| ------------- | --------------------------------------------------- | --------------------------------------------- |
| Download list | `~/Library/Application Support/com.ytdlmanager.app/library.db` | `%APPDATA%\com.ytdlmanager.app\library.db` |
| Logs          | `~/Library/Logs/com.ytdlmanager.app/app.log`        | `%LOCALAPPDATA%\com.ytdlmanager.app\logs\app.log` |

- Open the log folder from **Settings → Open log folder**.
- Videos go to the save folder you choose in Settings.

### Portable mode (Windows)

To keep the data next to the app instead, put an empty file named `portable` (or `portable.txt`) in the same folder as the `.exe`:

```
YT Download Manager\
├── YT Download Manager.exe
├── portable          ← empty file
├── library.db        ← created here
└── logs\app.log
```

The folder must be writable, so don't use this inside `C:\Program Files`. Theme and sort choices are still stored by the system web view, not in this folder.
