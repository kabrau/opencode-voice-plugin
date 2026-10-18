# opencode-voice-plugin

**English** · [Português (BR)](README.pt-BR.md)

Voice dictation for **OpenCode V2**: a microphone icon (`○`) in the prompt footer. Click it (or press
`ctrl+y`), speak, and the transcribed text becomes a message in the session.

Transcription uses **OpenRouter** (`POST /api/v1/audio/transcriptions`), and the API key is reused
from OpenCode itself when you already have OpenRouter connected — no environment variable, no
duplicating secrets. It works on **Windows, Linux and macOS** from the same code, and installs
**machine-wide** (not per project).

[Repository](https://github.com/kabrau/opencode-voice-plugin) ·
[Issues](https://github.com/kabrau/opencode-voice-plugin/issues) ·
[Design](DESIGN.md) · MIT

---

## How it works

1. `○` in the prompt footer (visible inside a session).
2. Click it, press `ctrl+y`, or type `/voice` → recording starts (`●` + seconds).
3. Click again (or wait for `maxSeconds`) → it stops and transcribes (`…`).
4. The **Dictation** dialog opens with the text — edit if you want and confirm → the message is sent.

It also works on the **home screen**: since there is no session yet, `ctrl+y` **creates one right
away** (before recording) and sends the text there — the same as typing and pressing Enter. Turn it
off with `"allowFromHome": false` if you prefer the microphone to work only inside a session.

---

## Requirements

- OpenCode **V2** (`opencode --version`).
- **ffmpeg** on the system:
  - Windows: `choco install ffmpeg`
  - Debian/Ubuntu: `sudo apt install ffmpeg pulseaudio-utils`
  - macOS: `brew install ffmpeg`
- An **OpenRouter** API key (see [Cost](#cost) and [API key](#api-key)).

---

## Install (via npm — recommended)

```bash
opencode plugin add opencode-voice-plugin
```

That's it — no cloning, no copying files. To update or remove:

```bash
opencode plugin update opencode-voice-plugin
opencode plugin remove opencode-voice-plugin
```

> To **configure options** (icons, keybind, device, etc.), see
> [Where to declare options](#where-to-declare-options) — that is a detail `plugin add` alone
> does not cover.

### Without npm (straight from GitHub)

```bash
opencode plugin add github:kabrau/opencode-voice-plugin
```

---

## Manual install (machine-wide)

If you prefer a local copy, OpenCode discovers plugins in the global config directory:

```
<global-config>/plugins/<name>/index.ts    # server entrypoint
<global-config>/plugins/<name>/tui.tsx     # TUI entrypoint (the plugin itself)
```

On Windows the global config lives in `C:\Users\<you>\.config\opencode`. On Linux/macOS it is
`~/.config/opencode` (or `$XDG_CONFIG_HOME/opencode`).

### Windows (PowerShell)

```powershell
git clone https://github.com/kabrau/opencode-voice-plugin.git
$dest = "$env:USERPROFILE\.config\opencode\plugins\voice"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item .\opencode-voice-plugin\src\* $dest
```

### Linux / macOS

```bash
git clone https://github.com/kabrau/opencode-voice-plugin.git
dest="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/voice"
mkdir -p "$dest"
cp opencode-voice-plugin/src/* "$dest/"
```

Then **restart `opencode`**.

### Alternative install (pointing at the clone)

Point the global `cli.json` at the cloned repository. This keeps the plugin updated via `git pull`
and is the way to pass options, since the discovery folder has nowhere to declare them:

```json
{
  "plugins": [
    {
      "package": "file:///path/to/opencode-voice-plugin",
      "options": {
        "language": "en",
        "keybind": "ctrl+y"
      }
    }
  ]
}
```

> The path can be an absolute path or a `file://` URL. **Add** it to the existing `plugins` array in
> `~/.config/opencode/cli.json`, without deleting the rest of the file.

---

## API key

The plugin resolves the key in this order:

1. **Environment variable** — `OPENROUTER_API_KEY` (or whatever `apiKeyEnv` says), if present.
2. **OpenCode's own credential store** — if you already connected OpenRouter, the plugin uses that
   key automatically. **Nothing to configure.**

In other words: if OpenRouter already shows up as connected, you **do not** need to create any
variable. Check with:

```bash
opencode auth list      # should list "OpenRouter ... stored"
```

If you prefer the env var (or do not have OpenRouter connected):

```powershell
setx OPENROUTER_API_KEY "sk-or-..."     # Windows; reopen the terminal afterwards
```

```bash
export OPENROUTER_API_KEY="sk-or-..."   # Linux/macOS (~/.bashrc / ~/.zshrc)
```

Create a key at <https://openrouter.ai/settings/keys>. Either way the key is **never** logged,
copied or stored by the plugin — and reading the store is read-only, from the file OpenCode itself
maintains (`<data>/opencode/auth.json`).

For an env-var-only policy, use `"apiKeyFromAuth": false`; to read from another integration (for
example the Console one), change `authIntegration`.

---

## Configuration

### Where to declare options

Options are read from **`cli.json`** (global config), **not** from `opencode.jsonc`. This holds even
if you installed by copying into `plugins/voice/`: add the entry below to the `plugins` array in
`~/.config/opencode/cli.json`, keeping the rest of the file intact.

```json
{
  "plugins": [
    {
      "package": "C:\\Users\\<you>\\.config\\opencode\\plugins\\voice",
      "options": {
        "autoSubmit": true
      }
    }
  ]
}
```

> Verified in both directions: with this entry `context.options` receives the object; declaring the
> same options in the `plugins` array of **`opencode.jsonc`** makes the TUI component receive `{}`.
> There is no duplication from the plugin also being discovered in the global folder.

Every option is optional.

| Option | Default | Description |
|---|---|---|
| `apiKeyEnv` | `"OPENROUTER_API_KEY"` | Name of the environment variable holding the key. Takes priority over the store. |
| `apiKeyFromAuth` | `true` | When the env var is absent, use the key already stored by OpenCode. |
| `authIntegration` | `"openrouter"` | OpenCode integration to read the key from. |
| `model` | `"openai/whisper-large-v3"` | OpenRouter STT model. |
| `language` | `"auto"` | ISO-639-1 code, or `"auto"` to auto-detect. |
| `baseUrl` | `"https://openrouter.ai/api/v1"` | Base URL of a provider compatible with `/audio/transcriptions`. |
| `device` | `null` | Microphone. `null` = auto-detect. Per-OS formats below. |
| `ffmpegPath` | `null` | Path to ffmpeg. `null` = look in PATH and known locations. |
| `keybind` | `"ctrl+y"` | Dictation shortcut. Use `"<leader>v"` if you prefer (`<leader>` = `ctrl+x`). |
| `autoSubmit` | `false` | `true` sends right away, skipping the review dialog. |
| `allowFromHome` | `true` | Allow dictating on the home screen, creating the session on the spot. |
| `maxSeconds` | `55` | Automatic recording cutoff. Safety ceiling is `120`. |
| `keepAudio` | `false` | `true` keeps the temporary WAV (debugging). |
| `icons` | `{ idle: "○", recording: "●", transcribing: "…" }` | Icon glyphs. Override if your font supports emoji. |

> **Why the default glyphs are `○ ● …` and not 🎤:** emoji outside the BMP (such as `🎤`) are missing
> from many console fonts and render as `?`; worse, their width is ambiguous, which **misaligns the
> clickable area** (clicks are routed by coordinate hit-testing). The default glyphs are BMP,
> single-width, and present in Consolas/Cascadia/DejaVu. If your terminal renders emoji correctly,
> use for example:
>
> ```json
> { "options": { "icons": { "idle": "🎤", "recording": "🔴", "transcribing": "⏳" } } }
> ```

`device` formats:

| OS | Format | Example |
|---|---|---|
| Windows | exact DirectShow name | `"Microphone (C922 Pro Stream Webcam)"` |
| Linux | Pulse/PipeWire source name | `"default"`, `"@DEFAULT_SOURCE@"`, `"alsa_input.pci-0000_00_1f.3.analog-stereo"` |
| Linux (ALSA) | `hw:CARD,DEV` | `"hw:1,0"` |
| macOS | numeric index | `"0"` |

---

## Usage

| Action | How |
|---|---|
| Start / stop | click the icon, or `ctrl+y`, or `/voice` |
| Choose microphone | command palette → **"Voice: choose microphone"** (the choice is remembered) |
| Send without reviewing | `"autoSubmit": true` in the options |

Icon states: `○` idle · `● Ns` recording · `…` transcribing. Errors always become a toast and never
freeze the TUI.

---

## Cost

`openai/whisper-large-v3` is billed **per token** (the audio is tokenized), and the price varies by
provider. Values read from the OpenRouter API in Oct/2026 (per 1M prompt tokens):

| Provider | Price (prompt) |
|---|---|
| DeepInfra | US$ 7.50 / 1M tokens |
| Together | US$ 25.00 / 1M tokens |
| Groq | US$ 30.83 / 1M tokens |

OpenRouter routes to an available provider automatically — the real cost of each request comes back
in the `usage.cost` field of the response. As a rough order of magnitude, OpenRouter's own
documentation shows a 9.2 s transcription costing **US$ 0.000508**.

**Check the current numbers** on the model page: <https://openrouter.ai/openai/whisper-large-v3>
(and the spend dashboard at <https://openrouter.ai/activity>). Do not trust the figures above long
term.

To switch models, just change `model` in the options (browse models with
`output_modalities=transcription` at <https://openrouter.ai/models?output_modalities=transcription>).

---

## Troubleshooting

**The plugin does not show up / did not load**

Check the log (it exists on Windows too):

```
C:\Users\<you>\.local\share\opencode\log\opencode.log      # Windows
~/.local/share/opencode/log/opencode.log                   # Linux/macOS
```

Look for `role=cli`. Confirm the files are in `<global-config>/plugins/voice/` and restart
`opencode`.

**"ffmpeg not found" toast**

Install ffmpeg (commands above) or point `ffmpegPath` at it explicitly. On Windows the plugin
automatically descends from the Chocolatey *shim*
(`C:\ProgramData\chocolatey\bin\ffmpeg.exe`) to the real binary at
`C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe`, because the shim may not forward
the stop command to the recording process.

**"Missing API key" toast**

The variable is not visible to the process. On Windows `setx` only applies to **new** terminals —
close and reopen. Check with `echo $env:OPENROUTER_API_KEY` (PowerShell) or `echo $OPENROUTER_API_KEY`.

**Records silence / nothing is transcribed**

The default device is probably a virtual cable. Run **"Voice: choose microphone"** and pick the real
microphone. The heuristic already avoids names like `CABLE Output`, `Stereo Mix`, `loopback`,
`Virtual` and `.monitor`, but not every virtual device gives itself away by name.

**Linux: no microphone / PulseAudio or ALSA error**

Install `pulseaudio-utils` (it provides `pactl`, used to list microphones). The plugin uses
`-f pulse` when it finds `pactl`, otherwise it falls back to `-f alsa` with `default`. To list
sources manually:

```bash
pactl list short sources        # ignore lines ending in .monitor
arecord -l                      # ALSA alternative
```

**WSL2**

Audio arrives through WSLg as a Pulse source (usually `RDPSource`). If `pactl info` fails, run
`wsl --shutdown` on Windows, reopen, and check the microphone permission under
*Settings → Privacy → Microphone*. As a last resort, set `device` explicitly.

**The icon shows as `?`** (or another odd character)

Your console font lacks the configured glyph. The default (`○ ● …`) works almost everywhere. If you
switched to emoji through `icons`, go back to the default or use a font with emoji support.

**I cannot click the icon**

1. Make sure the terminal sends mouse events: on **mintty/Git Bash**, check *Options → Mouse*
   (it should be enabled). OpenTUI turns on mouse tracking at startup.
2. Prefer the default glyphs (`○ ● …`). Emoji have ambiguous width and shift the clickable area.
3. Click **right on** the glyph (there is one space of padding on each side).
4. Meanwhile the shortcut does exactly the same: `ctrl+y` (or `<leader>v`: `ctrl+x`, then `v`), or
   `ctrl+p` → **"Voice: dictate"**, or `/voice`.

**Transcription fails or is slow**

The provider times out at around **60 s per request**. That is why `maxSeconds` defaults to 55. If
you raise it, the dialog warns that recordings over 1 minute may fail.

**The beginning of speech is lost (Windows)**

DirectShow takes about 1 s to open the device. Wait for `●` to appear, then start speaking.

---

## Development

```bash
npm install
npm run typecheck
```

No runtime dependencies — only Node built-ins (`child_process`, `fs`, `os`, `path`, `buffer`), which
work under the Bun runtime embedded in OpenCode.

All platform-specific logic is isolated in `src/capture.ts`. The other files contain no
`if (platform)`.

> Note: `@opencode/plugin` declares `engines: node >= 26.4.0`. On Node 24 `npm install` prints an
> `EBADENGINE` warning, harmless for typechecking.

### Layout

```
src/index.ts       server entrypoint (empty; required by the discovery layout)
src/tui.tsx        the plugin: icon slot, shortcuts, state machine, delivery
src/capture.ts     the ONLY module with platform-specific logic
src/ffmpeg.ts      binary resolution, process execution, clean stop
src/transcribe.ts  OpenRouter /audio/transcriptions
src/settings.ts    options + env + defaults
```

Design decisions and the API research (what was verified and what is **not** possible) are in
[DESIGN.md](DESIGN.md) (currently in Portuguese).

---

## Known limitations

- **One-shot dictation:** one recording = one message. There is no continuous/streaming dictation and
  no text-to-speech.
- **No direct writing into the prompt input:** V2 exposes no way — to any plugin — to insert text into
  the composer. This was verified three ways: (1) the `UI` API has nothing for prompt/composer
  (checked in 2.0.29 and 2.0.32); (2) the server OpenAPI has no `/tui/*` route; (3) the internal
  `tui.prompt.append` event is consumed by the TUI (`insertText` on the composer) but **nothing
  publishes it** — there is no HTTP endpoint and no RPC surface. V1 had `client.tui.appendPrompt`,
  removed in V2. That is why the text goes through the review dialog (pre-filled and editable), and
  the request to bring it back is at
  [anomalyco/opencode#51209](https://github.com/anomalyco/opencode/issues/51209)
  (see also [#54681](https://github.com/anomalyco/opencode/issues/54681)). Once the API exists,
  swapping the dialog for "insert into the prompt" is a small, local change.
- **Cloud transcription:** the audio is sent to OpenRouter and to the selected provider. Do not use it
  with sensitive information if that is a concern.
- **Linux and macOS** were validated through the commands and the logic, but the end-to-end test was
  done on Windows only. A real Linux test is still pending.

---

## Security

- The key comes from the environment variable or, if absent, from OpenCode's own store (read-only).
  It is never logged, copied or persisted by the plugin.
- The WAV is written to `os.tmpdir()` and deleted after transcription (unless `keepAudio: true`).
- A recording in progress is stopped when the plugin is unloaded.

---

## License

MIT — see [LICENSE](LICENSE).
