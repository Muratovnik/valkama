import { planningRefusal } from '@/shared/api/planningApi.ts'

/**
 * Why a write a card asked for first did not go through: the server's words where it said no,
 * the failure's own otherwise. A window or a question asked in place says it under itself.
 */
export function writeFailure(error: unknown): string {
  return planningRefusal(error)?.message ?? (error instanceof Error ? error.message : String(error))
}
