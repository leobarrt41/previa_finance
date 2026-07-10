import { config } from '../../config/env.js'

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'TimeoutError'
    || error.name === 'AbortError'
    || /aborted due to timeout/i.test(error.message)
    || /operation was aborted/i.test(error.message)
}

export async function callStructuredJsonAI(
  systemPrompt: string,
  userPayload: unknown,
  timeoutMs: number,
): Promise<unknown> {
  if (!config.ai.apiKey) {
    throw new Error('AI não configurada para processar faturas.')
  }

  const baseUrl = config.ai.baseUrl.replace(/\/$/, '')
  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
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
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: JSON.stringify(userPayload),
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`IA excedeu o tempo limite de ${Math.round(timeoutMs / 1000)}s ao processar a fatura.`)
    }
    throw error
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Falha na IA (${response.status}): ${text}`)
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json.choices?.[0]?.message?.content ?? '{}'

  try {
    return JSON.parse(content)
  } catch {
    throw new Error('IA não retornou JSON válido.')
  }
}
