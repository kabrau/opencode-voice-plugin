/**
 * Transcrição via OpenRouter (`POST /api/v1/audio/transcriptions`).
 *
 * O endpoint espera JSON com o áudio em base64 (não multipart). Mantemos a
 * interface `TranscriptionProvider` para que outro provedor possa ser adicionado
 * depois sem tocar no resto do plugin.
 */

import { readFile } from "node:fs/promises"

export interface TranscribeInput {
  /** Caminho do WAV a transcrever. */
  file: string
  apiKey: string
  model: string
  /** ISO-639-1; "auto" ou vazio omite o campo e deixa o provedor detectar. */
  language?: string
  /** Base do provedor; default é o OpenRouter. */
  baseUrl?: string
  timeoutMs?: number
  /** Injetável para testes. */
  fetchImpl?: typeof fetch
}

export interface TranscribeOutput {
  text: string
  cost?: number
  seconds?: number
}

export class TranscribeError extends Error {
  readonly status?: number
  readonly body?: string

  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.name = "TranscribeError"
    this.status = status
    this.body = body
  }
}

function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
  const base = (input.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")
  const doFetch = input.fetchImpl ?? fetch

  const audio = await readFile(input.file)
  const body: Record<string, unknown> = {
    model: input.model,
    input_audio: { data: audio.toString("base64"), format: "wav" },
  }
  if (input.language && input.language !== "auto") body.language = input.language

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 90_000)

  try {
    const response = await doFetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const raw = await response.text()
    if (!response.ok) {
      throw new TranscribeError(`The provider returned ${response.status}.`, response.status, truncate(raw))
    }

    let parsed: { text?: unknown; usage?: { cost?: unknown; seconds?: unknown } }
    try {
      parsed = JSON.parse(raw) as typeof parsed
    } catch {
      throw new TranscribeError("Invalid response from the provider.", response.status, truncate(raw))
    }

    const text = typeof parsed.text === "string" ? parsed.text.trim() : ""
    const cost = typeof parsed.usage?.cost === "number" ? parsed.usage.cost : undefined
    const seconds = typeof parsed.usage?.seconds === "number" ? parsed.usage.seconds : undefined
    return { text, cost, seconds }
  } catch (error) {
    if (error instanceof TranscribeError) throw error
    if (error instanceof Error && error.name === "AbortError") {
      throw new TranscribeError("Timed out talking to the provider.")
    }
    throw new TranscribeError(toMessage(error))
  } finally {
    clearTimeout(timeout)
  }
}

export interface TranscriptionProvider {
  readonly id: string
  transcribe(input: TranscribeInput): Promise<TranscribeOutput>
}

export const openRouterProvider: TranscriptionProvider = {
  id: "openrouter",
  transcribe,
}
