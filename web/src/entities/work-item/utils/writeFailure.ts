import { CutoverPendingError, planningRefusal } from '@/shared/api/planningApi.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'

type Translate = (key: string, values?: Record<string, unknown>) => string

/**
 * Why a write a card asked for first did not go through: the server's words where it said no
 * or where its store waits for the cutover, which names the command, and the product's
 * otherwise, from the catalogue, so a status code or a browser's own error text never reaches
 * the owner. A window or a question asked in place says it under itself.
 */
export function writeFailure(error: unknown, t: Translate): string {
  const refusal = planningRefusal(error)
  if (refusal !== null) return refusal.message
  if (error instanceof CutoverPendingError) return error.message
  const message = failureMessage(typedFailure(error))
  return t(message.key, message.params ?? {})
}
