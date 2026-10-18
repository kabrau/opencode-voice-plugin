/**
 * Plugin de ditado por voz para o OpenCode V2.
 *
 * Coloca um ícone de microfone no rodapé do prompt. Clique (ou atalho) inicia a
 * gravação; o segundo clique para, transcreve via OpenRouter e abre um dialog
 * para revisão antes de enviar o texto como mensagem da sessão.
 */

import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm } from "node:fs/promises"
import type { RGBA } from "@opentui/core"
import { captureControl, getBackend, installHint } from "./capture.js"
import { resolveFfmpeg, startRecording, type Recording } from "./ffmpeg.js"
import { PROVIDER_SAFE_SECONDS, resolveApiKey, resolveSettings } from "./settings.js"
import { TranscribeError, transcribe } from "./transcribe.js"

type State = "idle" | "recording" | "transcribing"
type Variant = "info" | "success" | "warning" | "error"

export default Plugin.define({
  id: "voice.mic",
  async setup(context) {
    const settings = resolveSettings(context.options)
    const backend = getBackend()
    const control = captureControl()

    const [state, setState] = createSignal<State>("idle")
    const [elapsed, setElapsed] = createSignal(0)
    const [hovered, setHovered] = createSignal(false)
    const [ready, setReady] = createSignal(true)

    const [deviceStore, setDeviceStore] = context.storage.store<{ name: string }>("voice.device", {
      initial: { name: "" },
    })

    let ffmpegPath: string | undefined
    let recording: Recording | undefined
    let ticker: ReturnType<typeof setInterval> | undefined
    let starting = false
    let stopping = false
    let delivering = false
    let inFlightStop: Promise<void> | undefined
    let activeSessionID: string | undefined

    const notify = (message: string, variant: Variant = "info", title = "Voz"): void => {
      context.ui.toast.show({ title, message, variant })
    }

    const failure = (error: unknown): string => {
      if (error instanceof TranscribeError && error.body) return `${error.message} ${error.body}`
      return error instanceof Error ? error.message : String(error)
    }

    function currentSessionID(): string | undefined {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    function clearTicker(): void {
      if (ticker) {
        clearInterval(ticker)
        ticker = undefined
      }
    }

    async function discard(file: string): Promise<void> {
      if (settings.keepAudio) return
      try {
        await rm(file, { force: true })
      } catch {
        // arquivo já removido
      }
    }

    async function ensureFfmpeg(): Promise<string | undefined> {
      if (ffmpegPath) return ffmpegPath
      try {
        ffmpegPath = await resolveFfmpeg(settings.ffmpegPath, control)
        setReady(true)
        return ffmpegPath
      } catch {
        setReady(false)
        notify(`ffmpeg não encontrado. ${installHint()}`, "error")
        return undefined
      }
    }

    async function resolveDevice(ffmpeg: string): Promise<string | undefined> {
      if (settings.device) return settings.device
      if (deviceStore.name) return deviceStore.name
      try {
        return await backend.defaultDevice(ffmpeg)
      } catch {
        return undefined
      }
    }

    /**
     * Sessão alvo. Na tela inicial não existe `sessionID`; ali ditar equivale a mandar a
     * primeira mensagem, então criamos a sessão na hora. Se `navigate` falhar, a sessão
     * já existe e seguimos com ela — navegar é conveniência, não pré-requisito.
     */
    async function ensureSession(): Promise<string | undefined> {
      const existing = currentSessionID()
      if (existing) return existing
      if (!settings.allowFromHome) return undefined

      let sessionID: string
      try {
        const info = await context.client.session.create({ location: context.location ?? null })
        sessionID = info.id
      } catch (error) {
        notify(failure(error), "error", "Não consegui criar a sessão")
        return undefined
      }

      try {
        context.ui.router.navigate({ type: "session", sessionID })
      } catch {
        // sem navegação, mas a sessão existe
      }
      return sessionID
    }

    async function deliver(text: string): Promise<void> {
      const sessionID = currentSessionID() ?? activeSessionID
      if (!sessionID) {
        notify("Abra uma sessão para ditar.", "warning")
        return
      }
      if (settings.autoSubmit) {
        await context.client.session.prompt({ sessionID, text })
        notify("Ditado enviado.", "success")
        return
      }
      const description =
        settings.maxSeconds > PROVIDER_SAFE_SECONDS
          ? "Gravações acima de 1 minuto podem falhar no provedor. Revise e edite antes de enviar."
          : "Revise e edite antes de enviar."
      const edited = await context.ui.dialog.prompt({ title: "Ditado", description, value: text })
      const finalText = edited?.trim()
      if (!finalText) return
      await context.client.session.prompt({ sessionID, text: finalText })
      notify("Ditado enviado.", "success")
    }

    async function start(): Promise<void> {
      const { key } = resolveApiKey(settings)
      if (!key) {
        notify(
          `Chave do OpenRouter ausente. Conecte com "opencode auth login" ou defina a variável ${settings.apiKeyEnv}.`,
          "error",
          "Chave da API ausente",
        )
        return
      }

      const sessionID = await ensureSession()
      if (!sessionID) {
        notify("Abra uma sessão para ditar.", "warning")
        return
      }
      activeSessionID = sessionID

      const ffmpeg = await ensureFfmpeg()
      if (!ffmpeg) return

      const device = await resolveDevice(ffmpeg)
      const file = join(tmpdir(), `opencode-voice-${Date.now()}.wav`)

      let args: string[]
      try {
        args = [
          "-hide_banner",
          "-loglevel",
          "error",
          ...backend.inputArgs(device),
          "-ac",
          "1",
          "-ar",
          "16000",
          "-y",
          file,
        ]
      } catch (error) {
        notify(failure(error), "error", "Microfone")
        return
      }

      recording = startRecording({ ffmpeg, args, file, control })
      setElapsed(0)
      setState("recording")

      ticker = setInterval(() => {
        setElapsed((value) => value + 1)
        if (elapsed() >= settings.maxSeconds) void stop().catch(() => {})
      }, 1_000)
    }

    async function stop(): Promise<void> {
      if (stopping || state() !== "recording" || !recording) return
      stopping = true
      clearTicker()

      const current = recording
      recording = undefined
      setState("transcribing")

      const run = (async () => {
        try {
          const result = await current.stop()
          if (result.code !== 0 && result.code !== null) {
            const detail = result.stderr.trim()
            notify(`ffmpeg terminou com código ${result.code}.${detail ? ` ${detail}` : ""}`, "error", "Falha na gravação")
            return
          }

          const { key } = resolveApiKey(settings)
          if (!key) {
            notify(`Defina a variável de ambiente ${settings.apiKeyEnv} ou conecte o OpenRouter.`, "error", "Chave da API ausente")
            return
          }

          const { text } = await transcribe({
            file: current.file,
            apiKey: key,
            model: settings.model,
            language: settings.language,
            baseUrl: settings.baseUrl,
          })

          setState("idle")

          if (!text) {
            notify("Não entendi nada no áudio. Tente falar mais perto do microfone.", "warning")
            return
          }

          delivering = true
          try {
            await deliver(text)
          } finally {
            delivering = false
          }
        } catch (error) {
          notify(failure(error), "error")
        } finally {
          setState("idle")
          stopping = false
          inFlightStop = undefined
          activeSessionID = undefined
          await discard(current.file)
        }
      })()

      inFlightStop = run
      await run
    }

    async function toggle(): Promise<void> {
      if (delivering || state() === "transcribing") return
      if (state() === "recording") {
        await stop()
        return
      }
      if (starting) return
      starting = true
      try {
        await start()
      } catch (error) {
        notify(failure(error), "error")
      } finally {
        starting = false
      }
    }

    async function chooseDevice(): Promise<void> {
      const ffmpeg = await ensureFfmpeg()
      if (!ffmpeg) return

      let devices: string[]
      try {
        devices = await backend.listDevices(ffmpeg)
      } catch (error) {
        notify(failure(error), "error", "Microfone")
        return
      }

      if (devices.length === 0) {
        notify("Nenhum microfone encontrado.", "warning")
        return
      }

      const current = settings.device ?? (deviceStore.name || undefined)
      const choice = await context.ui.dialog.select({
        title: "Microfone",
        current,
        options: devices.map((device) => ({ title: device, value: device })),
      })
      if (!choice) return

      await setDeviceStore((draft) => {
        draft.name = choice
      })
      notify(`Microfone: ${choice}`, "success")
    }

    const iconColor = (): RGBA => {
      if (state() === "recording") return context.theme.text.feedback.error.base
      if (state() === "transcribing") return context.theme.text.feedback.warning.base
      if (!ready()) return context.theme.text.muted
      if (hovered()) return context.theme.text.action.primary.state({ hovered: true })
      return context.theme.text.base
    }

    const iconLabel = (showDetails: boolean): string => {
      const icons = settings.icons
      if (state() === "recording") {
        return showDetails ? ` ${icons.recording} ${elapsed()}s ` : ` ${icons.recording} `
      }
      if (state() === "transcribing") return ` ${icons.transcribing} `
      return ` ${icons.idle} `
    }

    const unregisterSlot = context.ui.slot({
      append: "prompt.footer",
      render: (input) => {
        if (input.mode === "shell") return null
        return (
          <text
            fg={iconColor()}
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onMouseDown={() => {
              void toggle()
            }}
          >
            {iconLabel(input.showDetails)}
          </text>
        )
      },
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "voice.mic.toggle",
          title: "Voz: ditar",
          description: "Grava do microfone e transcreve para enviar na sessão",
          group: "Voz",
          bind: settings.keybind,
          palette: true,
          slash: { name: "voice" },
          run: () => {
            void toggle()
          },
        },
        {
          id: "voice.mic.device",
          title: "Voz: escolher microfone",
          description: "Lista os microfones e guarda o escolhido",
          group: "Voz",
          palette: true,
          run: () => {
            void chooseDevice()
          },
        },
      ],
    }))

    return async () => {
      clearTicker()
      unregisterSlot()
      if (inFlightStop) await inFlightStop.catch(() => {})
      if (recording) {
        const current = recording
        recording = undefined
        try {
          await current.stop()
        } catch {
          // processo já encerrado
        }
        await discard(current.file)
      }
    }
  },
})
