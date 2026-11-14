/**
 * What the reader folded or opened against a rule, per planning space.
 *
 * A board's lanes, a graph's frames and a tree's rows each start folded or open
 * by a rule of their own, and only what the reader chose against that rule is
 * kept: a choice that comes back to what the rule says is forgotten, so the
 * thing follows its work again, and a choice survives a reload. Each caller
 * keeps its choices under a key of its own, because the rules differ and one
 * choice would mean different things in each.
 *
 * Browser storage rather than the address. The address is bounded and is what a
 * shared link carries, and a set of folded things is neither part of what a link
 * points at nor small. Storage can be missing or refuse a write; then the choice
 * lasts as long as the page, which is all it loses.
 */
import { computed } from 'vue'

import { useStorage } from '@vueuse/core'

type Choices = Record<string, Record<string, boolean>>

/** Spaces remembered, newest kept; a choice older than that is the rule again. */
const MAX_SPACES = 24
/** Choices remembered per space, newest kept. */
const MAX_CHOICES = 400

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** What storage holds, read as choices: anything else in it is dropped. */
function choicesIn(value: unknown): Choices {
  if (!isRecord(value)) return {}
  const read: Choices = {}
  for (const [space, choices] of Object.entries(value)) {
    if (!isRecord(choices)) continue
    const kept: [string, boolean][] = []
    for (const [id, folded] of Object.entries(choices))
      if (typeof folded === 'boolean') kept.push([id, folded])
    read[space] = Object.fromEntries(kept.slice(-MAX_CHOICES))
  }
  return read
}

/** `storageKey` names the caller's choices in storage; `space` is the space they are made in. */
export function useFoldChoices(storageKey: string, space: () => string) {
  const stored = useStorage<Choices>(
    storageKey,
    {},
    typeof localStorage === 'undefined' ? undefined : localStorage,
    {
      mergeDefaults: (value) => choicesIn(value),
      onError() {
        // Storage that refuses a write keeps the choice for as long as the page.
      },
    },
  )

  /** The reader's choices in this space, by id: true is folded. */
  const choices = computed(() => choicesIn(stored.value)[space()] ?? {})

  /**
   * Keep the reader's choice to fold or open `id`. `ruled` is what the rule
   * would make it: a choice equal to it is forgotten. Where no rule is asked
   * about, as under a filter, the choice is kept whatever it is.
   */
  function choose(id: string, folded: boolean, ruled?: boolean) {
    const { [space()]: current = {}, ...others } = choicesIn(stored.value)
    const rest = Object.entries(current).filter(([other]) => other !== id)
    const kept = folded === ruled ? rest : [...rest, [id, folded] as const]
    stored.value = {
      ...Object.fromEntries(Object.entries(others).slice(-(MAX_SPACES - 1))),
      [space()]: Object.fromEntries(kept.slice(-MAX_CHOICES)),
    }
  }

  return { choices, choose }
}
