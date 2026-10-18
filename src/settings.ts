/**
 * Configuração do plugin: options do cli.json + variáveis de ambiente + defaults.
 *
 * Resolução da chave da API, nesta ordem:
 *   1. `process.env[apiKeyEnv]`
 *   2. store de credenciais do próprio OpenCode (`auth.json`), se `apiKeyFromAuth`
 *
 * A chave nunca é logada, copiada nem gravada em nenhum lugar.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Glifos do ícone. Os defaults são caracteres do BMP com largura 1, que existem
 * nas fontes de console (Consolas, Cascadia, DejaVu) e são medidos corretamente —
 * emojis fora do BMP (ex.: 🎤) aparecem como "?" em alguns terminais e desalinham
 * a área clicável. Se sua fonte suportar emoji, sobrescreva via `icons`.
 */
export interface VoiceIcons {
  idle: string
  recording: string
  transcribing: string
}

export const DEFAULT_ICONS: VoiceIcons = {
  idle: "○",
  recording: "●",
  transcribing: "…",
}

export interface VoiceSettings {
  /** Nome da variável de ambiente que guarda a chave do OpenRouter (prioridade). */
  apiKeyEnv: string
  /** Se a env var não existir, usa a chave já guardada pelo OpenCode. */
  apiKeyFromAuth: boolean
  /** Integração do OpenCode de onde ler a chave (ex.: "openrouter"). */
  authIntegration: string
  /** Modelo de STT (ex.: "openai/whisper-large-v3"). */
  model: string
  /** Código ISO-639-1 ou "auto" (omite o campo no request). */
  language: string
  /** Base URL do provedor compatível com /audio/transcriptions. */
  baseUrl: string
  /** Dispositivo de áudio explícito; null = autodetectar. */
  device: string | null
  /** Caminho explícito do binário ffmpeg; null = resolver automaticamente. */
  ffmpegPath: string | null
  /** Binding do comando de ditado (ex.: "ctrl+y" ou "<leader>v"). */
  keybind: string
  /** Envia direto, sem abrir o dialog de revisão. */
  autoSubmit: boolean
  /** Permite ditar na tela inicial, criando a sessão automaticamente. */
  allowFromHome: boolean
  /** Corte automático da gravação, em segundos. */
  maxSeconds: number
  /** Mantém o WAV temporário depois de transcrever (debug). */
  keepAudio: boolean
  /** Glifos do ícone por estado. */
  icons: VoiceIcons
}

export const DEFAULTS: VoiceSettings = {
  apiKeyEnv: "OPENROUTER_API_KEY",
  apiKeyFromAuth: true,
  authIntegration: "openrouter",
  model: "openai/whisper-large-v3",
  language: "auto",
  baseUrl: "https://openrouter.ai/api/v1",
  device: null,
  ffmpegPath: null,
  keybind: "ctrl+y",
  autoSubmit: false,
  allowFromHome: true,
  maxSeconds: 55,
  keepAudio: false,
  icons: DEFAULT_ICONS,
}

/**
 * O provedor de STT estoura em ~60 s por requisição, então uma gravação mais longa
 * que isso provavelmente falha. Mantemos o teto em 120 s apenas como rede de segurança.
 */
export const MAX_SECONDS_CEILING = 120
export const PROVIDER_SAFE_SECONDS = 60

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function resolveSettings(options: Readonly<Record<string, unknown>> | undefined): VoiceSettings {
  const raw = options ?? {}
  const settings: VoiceSettings = { ...DEFAULTS }

  settings.apiKeyEnv = nonEmptyString(raw.apiKeyEnv) ?? settings.apiKeyEnv
  settings.apiKeyFromAuth = raw.apiKeyFromAuth !== false
  settings.authIntegration = nonEmptyString(raw.authIntegration) ?? settings.authIntegration
  settings.model = nonEmptyString(raw.model) ?? settings.model
  settings.language = nonEmptyString(raw.language) ?? settings.language
  settings.baseUrl = nonEmptyString(raw.baseUrl) ?? settings.baseUrl
  settings.device = nonEmptyString(raw.device) ?? null
  settings.ffmpegPath = nonEmptyString(raw.ffmpegPath) ?? null
  settings.keybind = nonEmptyString(raw.keybind) ?? settings.keybind
  settings.autoSubmit = raw.autoSubmit === true
  settings.allowFromHome = raw.allowFromHome !== false
  settings.keepAudio = raw.keepAudio === true

  const rawIcons = raw.icons as Partial<Record<keyof VoiceIcons, unknown>> | undefined
  if (rawIcons && typeof rawIcons === "object") {
    settings.icons = {
      idle: nonEmptyString(rawIcons.idle) ?? DEFAULT_ICONS.idle,
      recording: nonEmptyString(rawIcons.recording) ?? DEFAULT_ICONS.recording,
      transcribing: nonEmptyString(rawIcons.transcribing) ?? DEFAULT_ICONS.transcribing,
    }
  }

  if (typeof raw.maxSeconds === "number" && Number.isFinite(raw.maxSeconds) && raw.maxSeconds > 0) {
    settings.maxSeconds = Math.min(Math.floor(raw.maxSeconds), MAX_SECONDS_CEILING)
  }

  return settings
}

/** Diretório de dados do OpenCode. Layout fixo, inclusive no Windows. */
function openCodeDataDir(): string {
  const xdg = nonEmptyString(process.env.XDG_DATA_HOME)
  return xdg ? join(xdg, "opencode") : join(homedir(), ".local", "share", "opencode")
}

/**
 * Lê a chave da API que o próprio OpenCode guardou (ex.: via `/connect`).
 * Somente leitura, sem log; qualquer falha ou formato inesperado retorna undefined.
 */
export function readStoredApiKey(integration: string): string | undefined {
  try {
    const raw = readFileSync(join(openCodeDataDir(), "auth.json"), "utf8")
    const parsed = JSON.parse(raw) as Record<string, { type?: unknown; key?: unknown } | undefined>
    const entry = parsed?.[integration]
    return entry ? nonEmptyString(entry.key) : undefined
  } catch {
    return undefined
  }
}

export interface ApiKeyResolution {
  key?: string
  source: "env" | "auth-store" | "none"
}

/** Env var tem prioridade; senão, o store do OpenCode. */
export function resolveApiKey(settings: VoiceSettings): ApiKeyResolution {
  const fromEnv = nonEmptyString(process.env[settings.apiKeyEnv])
  if (fromEnv) return { key: fromEnv, source: "env" }

  if (settings.apiKeyFromAuth) {
    const stored = readStoredApiKey(settings.authIntegration)
    if (stored) return { key: stored, source: "auth-store" }
  }

  return { source: "none" }
}
