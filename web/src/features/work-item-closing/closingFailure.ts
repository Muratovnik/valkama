import { planningRefusal } from '@/shared/api/planningApi.ts'

/** Why a write that closes or puts off work did not go through: the server's words where it said no. */
export function closingFailure(error: unknown): string {
  return planningRefusal(error)?.message ?? (error instanceof Error ? error.message : String(error))
}
