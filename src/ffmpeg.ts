/**
 * Resolução do binário do ffmpeg, execução de processos e parada limpa.
 * Este arquivo é intencionalmente livre de lógica por plataforma: tudo que muda
 * entre sistemas vem injetado via `ProcessControl` (definido em `capture.ts`).
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import type { ProcessControl } from "./capture.js"

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Procura um executável no PATH. Usa o separador de PATH do próprio Node, sem branch de plataforma. */
export function findOnPath(name: string, extensions: readonly string[]): string | undefined {
  const entries = (process.env.PATH ?? "").split(delimiter)
  for (const entry of entries) {
    if (!entry) continue
    for (const extension of extensions) {
      const candidate = join(entry, name + extension)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/** Executa um comando e captura stdout/stderr. Nunca rejeita: o resultado carrega o erro. */
export function runCommand(
  command: string,
  args: readonly string[],
  control: ProcessControl,
  timeoutMs = 15_000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    const child = spawn(command, [...args], { windowsHide: true })
    const timer = setTimeout(() => {
      void control.killTree(child.pid ?? 0)
    }, timeoutMs)

    const finish = (code: number | null) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on("close", (code) => finish(code))
    child.on("error", (error) => {
      stderr += (stderr ? "\n" : "") + error.message
      finish(null)
    })
  })
}

const ffmpegCache = new Map<string, string>()

/**
 * Ordem de resolução: opção explícita → PATH → caminhos conhecidos da plataforma.
 * Se o caminho resolvido for um launcher (ex.: shim do Chocolatey no Windows),
 * desce para o binário real, para que `q` no stdin chegue ao processo certo.
 */
export function resolveFfmpeg(explicit: string | null | undefined, control: ProcessControl): Promise<string> {
  const key = explicit ?? ""
  const cached = ffmpegCache.get(key)
  if (cached && existsSync(cached)) return Promise.resolve(cached)

  const candidates: string[] = []
  if (explicit) candidates.push(explicit)
  const onPath = findOnPath("ffmpeg", control.pathExtensions)
  if (onPath) candidates.push(onPath)
  candidates.push(...control.knownPaths)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const resolved = control.isShim(candidate)
      ? (control.knownPaths.find((path) => existsSync(path) && !control.isShim(path)) ?? candidate)
      : candidate
    ffmpegCache.set(key, resolved)
    return Promise.resolve(resolved)
  }

  return Promise.reject(new Error("ffmpeg não encontrado"))
}

export interface RecordingResult {
  code: number | null
  stderr: string
}

export interface Recording {
  readonly file: string
  /** Escreve `q` no stdin para o ffmpeg fechar o WAV; mata a árvore após 2 s se preciso. */
  stop(): Promise<RecordingResult>
}

export function startRecording(options: {
  ffmpeg: string
  args: readonly string[]
  file: string
  control: ProcessControl
}): Recording {
  const { ffmpeg, args, file, control } = options
  const child = spawn(ffmpeg, [...args], {
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
    detached: control.spawnDetached,
  })

  let stderr = ""
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 8_000) stderr += chunk.toString()
  })
  // O stdin pode fechar sozinho se o ffmpeg morrer durante a gravação.
  child.stdin?.on("error", () => {})

  const exited = new Promise<RecordingResult>((resolve) => {
    child.on("close", (code) => resolve({ code, stderr }))
    child.on("error", (error) => {
      stderr += (stderr ? "\n" : "") + error.message
      resolve({ code: null, stderr })
    })
  })

  let stopping: Promise<RecordingResult> | undefined

  return {
    file,
    stop() {
      if (stopping) return stopping
      stopping = (async () => {
        try {
          child.stdin?.write("q\n")
          child.stdin?.end()
        } catch {
          // stdin já estava fechado
        }
        const timer = setTimeout(() => {
          void control.killTree(child.pid ?? 0)
        }, 2_000)
        const result = await exited
        clearTimeout(timer)
        return result
      })()
      return stopping
    },
  }
}
