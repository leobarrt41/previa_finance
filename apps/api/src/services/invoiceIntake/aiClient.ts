import { config } from '../../config/env.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'TimeoutError'
    || error.name === 'AbortError'
    || /aborted due to timeout/i.test(error.message)
    || /operation was aborted/i.test(error.message)
}

function isRetryableAIStatus(status: number): boolean {
  return status === 429 || status === 503
}

async function callOpenAI(systemPrompt: string, userPayload: unknown, timeoutMs: number): Promise<string> {
  const baseUrl = config.ai.baseUrl.replace(/\/$/, '')

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Falha na IA (${response.status}): ${text}`)
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }

  return json.choices?.[0]?.message?.content ?? '{}'
}

async function callGemini(systemPrompt: string, userPayload: unknown, timeoutMs: number): Promise<string> {
  const model = config.ai.model || 'gemini-3.5-flash-lite'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(config.ai.apiKey)}`

  let lastErrorText = ''

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: JSON.stringify(userPayload) }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (response.ok) {
      const json = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }

      return json.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim() || '{}'
    }

    const text = await response.text().catch(() => '')
    lastErrorText = text

    if (isRetryableAIStatus(response.status) && attempt < 2) {
      const waitMs = 1000 * 2 ** attempt
      console.warn(`Gemini indisponível (${response.status}). Tentativa ${attempt + 1}/3. Aguardando ${waitMs}ms.`)
      await sleep(waitMs)
      continue
    }

    if (isRetryableAIStatus(response.status)) {
      throw new Error('O serviço de inteligência está temporariamente sobrecarregado. Aguarde alguns segundos e tente enviar a fatura novamente.')
    }

    throw new Error(`Falha na Gemini (${response.status}): ${text}`)
  }

  throw new Error(`Falha na Gemini: ${lastErrorText}`)
}

export async function callStructuredJsonAI(
  systemPrompt: string,
  userPayload: unknown,
  timeoutMs: number,
): Promise<unknown> {
  if (!config.ai.apiKey) {
    throw new Error('AI não configurada para processar faturas.')
  }

  let content: string
  try {
    content = config.ai.provider === 'gemini'
      ? await callGemini(systemPrompt, userPayload, timeoutMs)
      : await callOpenAI(systemPrompt, userPayload, timeoutMs)
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`IA excedeu o tempo limite de ${Math.round(timeoutMs / 1000)}s ao processar a fatura.`)
    }
    throw error
  }

  try {
    return JSON.parse(content)
  } catch {
    throw new Error('IA não retornou JSON válido.')
  }
}