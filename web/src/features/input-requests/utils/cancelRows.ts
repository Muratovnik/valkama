import type { CancelList } from '@/shared/api/inputRequestAction.ts'
import { holderName } from '@/shared/lib/actor.ts'

/**
 * What a cancel closes, a row per item: its reference, and its title with who holds it, or
 * `nobody` where no one does.
 */
export function closingRows(
  cancels: CancelList['cancels'],
  nobody: string,
): [reference: string, rest: string][] {
  return cancels.map((one) => [
    one.reference,
    `${one.title} · ${one.holder.map((holder) => holderName(holder)).join(', ') || nobody}`,
  ])
}
