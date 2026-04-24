import { useState, useCallback } from 'react'
import { ApiError } from '../services/api'

export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

export function useAsync<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
) {
  const [state, setState] = useState<AsyncState<TResult>>({ status: 'idle' })

  const execute = useCallback(
    async (args: TArgs) => {
      setState({ status: 'loading' })
      try {
        const data = await fn(args)
        setState({ status: 'success', data })
        return data
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Erro inesperado'
        setState({ status: 'error', message })
      }
    },
    [fn],
  )

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { state, execute, reset }
}
