/**
 * The labels an item's label is attached from: the ones the space's work carries, the most
 * used first, as the filter menu and the new-task dialog offer them. The page that holds the
 * space's model provides them; a card under it reads them without a read of its own, so the
 * list says what the board says. Without a provider there is nothing to offer, and a label is
 * then typed.
 */
import { computed, inject, provide, toValue } from 'vue'
import type { ComputedRef, InjectionKey, MaybeRefOrGetter } from 'vue'

import { byUse } from '@/shared/lib/byUse.ts'

const KEY: InjectionKey<ComputedRef<readonly string[]>> = Symbol('space-labels')

export function provideSpaceLabels(
  items: MaybeRefOrGetter<readonly { labels: readonly string[] }[] | null | undefined>,
): void {
  provide(
    KEY,
    computed(() => byUse(toValue(items)?.flatMap((item) => item.labels) ?? [])),
  )
}

export function injectSpaceLabels(): ComputedRef<readonly string[]> {
  return inject(
    KEY,
    computed(() => []),
    true,
  )
}
