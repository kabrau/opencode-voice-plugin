/**
 * ÚNICO módulo com lógica por plataforma.
 *
 * Aqui vivem: montagem dos argumentos de entrada do ffmpeg, listagem de dispositivos
 * e a heurística de microfone padrão. Também expõe `ProcessControl`, que injeta no
 * `ffmpeg.ts` tudo que é específico do sistema (caminhos conhecidos, como matar a
 * árvore de processos, etc.), mantendo o resto do código livre de `if (platform)`.
 */

import { spawn } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import { findOnPath, runCommand } from "./ffmpeg.js"

export const PLATFORM: NodeJS.Platform = process.platform

/** Um arquivo abaixo disso é tratado como launcher/shim, não como o ffmpeg real. */
const SHIM_MAX_BYTES = 1_000_000

const WINDOWS_FFMPEG_PATHS = [
  "C:\\ProgramData\\chocolatey\\lib\\ffmpeg\\tools\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
  "C:\\ffmpeg\\bin\\ffmpeg.exe",
]
const DARWIN_FFMPEG_PATHS = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
const LINUX_FFMPEG_PATHS = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/snap/bin/ffmpeg"]

function pathExtensions(): readonly string[] {
  return PLATFORM === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]
}

function isShim(file: string): boolean {
  if (PLATFORM !== "win32") return false
  try {
    const stats = statSync(file)
    return stats.isFile() && stats.size < SHIM_MAX_BYTES
  } catch {
    return false
  }
}

export interface ProcessControl {
  readonly knownPaths: readonly string[]
  readonly pathExtensions: readonly string[]
  readonly spawnDetached: boolean
  isShim(file: string): boolean
  killTree(pid: number): Promise<void>
}

export function captureControl(): ProcessControl {
  return {
    knownPaths: PLATFORM === "win32" ? WINDOWS_FFMPEG_PATHS : PLATFORM === "darwin" ? DARWIN_FFMPEG_PATHS : LINUX_FFMPEG_PATHS,
    pathExtensions: pathExtensions(),
    spawnDetached: PLATFORM !== "win32",
    isShim,
    async killTree(pid: number) {
      if (!pid) return
      if (PLATFORM === "win32") {
        await new Promise<void>((resolve) => {
          const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true })
          killer.on("close", () => resolve())
          killer.on("error", () => resolve())
        })
        return
      }
      try {
        process.kill(-pid, "SIGKILL")
      } catch {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          // já morreu
        }
      }
    },
  }
}

const CONTROL: ProcessControl = captureControl()

export function installHint(): string {
  if (PLATFORM === "win32") {
    return "Install ffmpeg with `choco install ffmpeg` (or download it from ffmpeg.org and add it to PATH)."
  }
  if (PLATFORM === "darwin") {
    return "Install ffmpeg with `brew install ffmpeg`."
  }
  return "Install ffmpeg with `sudo apt install ffmpeg pulseaudio-utils` (Debian/Ubuntu) or the equivalent for your distro."
}

export interface CaptureBackend {
  /** argumentos de entrada do ffmpeg para o dispositivo (nome ou id) */
  inputArgs(device?: string): string[]
  /** lista de dispositivos legíveis (para log e para o caso de múltiplos microfones) */
  listDevices(ffmpeg: string): Promise<string[]>
  /** dispositivo usado quando o usuário não configura `device` */
  defaultDevice(ffmpeg: string): Promise<string | undefined>
}

// ---------------------------------------------------------------------------
// Parsing (puro, testável)
// ---------------------------------------------------------------------------

/** `"Microphone (C922)" (audio)` → `Microphone (C922)`; ignora dispositivos de vídeo. */
export function parseDshowDevices(text: string): string[] {
  const devices: string[] = []
  const pattern = /"([^"]+)"\s*\((?:audio|áudio)\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match[1]) devices.push(match[1].trim())
  }
  return devices
}

/** `pactl list short sources`: nome na 2ª coluna; descarta monitores de saída. */
export function parsePactlSources(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((columns) => columns.length >= 2 && columns[1] !== undefined)
    .map((columns) => (columns[1] ?? "").trim())
    .filter((name) => name.length > 0 && !name.endsWith(".monitor"))
}

/** `arecord -l`: `card 1: PCH [...], device 0: ...` → `hw:1,0`. */
export function parseArecordDevices(text: string): string[] {
  const devices: string[] = []
  const pattern = /card\s+(\d+):[\s\S]*?device\s+(\d+):/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    devices.push(`hw:${match[1]},${match[2]}`)
  }
  return devices
}

/** `ffmpeg -f avfoundation -list_devices`: lista os índices do bloco de áudio. */
export function parseAvfoundationDevices(text: string): string[] {
  const marker = "AVFoundation audio devices:"
  const index = text.indexOf(marker)
  if (index < 0) return []
  const section = text.slice(index)
  const devices: string[] = []
  const pattern = /\[(\d+)\]\s+(.+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(section)) !== null) {
    if (match[1]) devices.push(match[1].trim())
  }
  return devices
}

// ---------------------------------------------------------------------------
// Heurística de dispositivo padrão
// ---------------------------------------------------------------------------

const VIRTUAL = [/cable output/i, /stereo mix/i, /what u hear/i, /\.monitor\b/i, /loopback/i, /virtual/i]
const PREFERRED = [/microphone/i, /microfone/i, /headset/i, /mic\b/i, /^default$/i, /@default_source@/i]

/**
 * Muitas máquinas têm cabos virtuais (VB-Audio, MSI Sound Tune, monitores do Pulse)
 * que abrem mas gravam silêncio. Preferimos nomes de microfone de verdade e evitamos
 * os virtuais; sem candidato ideal, usamos o primeiro não virtual.
 */
export function pickDefaultDevice(devices: readonly string[]): string | undefined {
  const list = devices.map((device) => device.trim()).filter(Boolean)
  if (list.length === 0) return undefined
  const clean = list.filter((name) => !VIRTUAL.some((pattern) => pattern.test(name)))
  const pool = clean.length > 0 ? clean : list
  return pool.find((name) => PREFERRED.some((pattern) => pattern.test(name))) ?? pool[0]
}

// ---------------------------------------------------------------------------
// Backends por plataforma
// ---------------------------------------------------------------------------

function windowsInputArgs(device?: string): string[] {
  if (!device) {
    throw new Error("On Windows you must pick a DirectShow microphone before recording.")
  }
  return ["-f", "dshow", "-i", `audio=${device}`]
}

async function windowsListDevices(ffmpeg: string): Promise<string[]> {
  // O ffmpeg sai com código != 0 aqui de propósito; a lista vem no stderr.
  const { stderr } = await runCommand(
    ffmpeg,
    ["-hide_banner", "-f", "dshow", "-list_devices", "true", "-i", "dummy"],
    CONTROL,
  )
  return parseDshowDevices(stderr)
}

const windowsBackend: CaptureBackend = {
  inputArgs: windowsInputArgs,
  listDevices: windowsListDevices,
  defaultDevice: async (ffmpeg) => pickDefaultDevice(await windowsListDevices(ffmpeg)),
}

let pactlCache: boolean | undefined

function hasPactl(): boolean {
  if (pactlCache === undefined) {
    pactlCache = findOnPath("pactl", pathExtensions()) !== undefined
  }
  return pactlCache
}

function linuxInputArgs(device?: string): string[] {
  const driver = hasPactl() ? "pulse" : "alsa"
  return ["-f", driver, "-i", device ?? "default"]
}

async function linuxListDevices(_ffmpeg: string): Promise<string[]> {
  if (hasPactl()) {
    const { stdout } = await runCommand("pactl", ["list", "short", "sources"], CONTROL)
    const sources = parsePactlSources(stdout)
    if (sources.length > 0) return sources
  }
  const { stdout } = await runCommand("arecord", ["-l"], CONTROL)
  return parseArecordDevices(stdout)
}

const linuxBackend: CaptureBackend = {
  inputArgs: linuxInputArgs,
  listDevices: linuxListDevices,
  defaultDevice: async (ffmpeg) => pickDefaultDevice(await linuxListDevices(ffmpeg)),
}

function macInputArgs(device?: string): string[] {
  return ["-f", "avfoundation", "-i", `:${device ?? "0"}`]
}

async function macListDevices(ffmpeg: string): Promise<string[]> {
  const { stderr } = await runCommand(
    ffmpeg,
    ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
    CONTROL,
  )
  return parseAvfoundationDevices(stderr)
}

const macBackend: CaptureBackend = {
  inputArgs: macInputArgs,
  listDevices: macListDevices,
  defaultDevice: async (ffmpeg) => pickDefaultDevice(await macListDevices(ffmpeg)),
}

const fallbackBackend: CaptureBackend = linuxBackend

export function getBackend(): CaptureBackend {
  if (PLATFORM === "win32") return windowsBackend
  if (PLATFORM === "darwin") return macBackend
  if (existsSync("/proc") || PLATFORM === "linux") return linuxBackend
  return fallbackBackend
}
