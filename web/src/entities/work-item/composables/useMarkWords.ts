/**
 * The words of the marks, each looked up once per language.
 *
 * A row of a list asks for a filter mark's words and for the facet's name
 * inside them, on every mark of every row, and the same few dozen sentences come
 * back each time. They are kept by the i18n instance they came from, with the
 * language in the key, so a change of language reads as one to a render and a
 * second instance keeps words of its own.
 */
import { useI18n } from 'vue-i18n'

import type { FacetId, FacetMark } from '@/entities/work-item/utils/facets.ts'

export interface MarkWords {
  /** «Фильтр: тип Улучшение», or the way back out of it. */
  filterName: (facet: FacetId, active: boolean, value: string) => string
  /** A mark's words: data as it is, or its key looked up. */
  say: (text: FacetMark['text']) => string
}

const kept = new WeakMap<object, Map<string, string>>()
const SEPARATOR = String.fromCodePoint(0)

export function useMarkWords(): MarkWords {
  const { t, locale } = useI18n()
  const words = kept.get(t) ?? new Map<string, string>()
  kept.set(t, words)

  function look(key: string, params: Record<string, string | number> = {}) {
    const id = [locale.value, key, ...Object.values(params)].join(SEPARATOR)
    const known = words.get(id)
    if (known !== undefined) return known
    const word = t(key, params)
    words.set(id, word)
    return word
  }

  return {
    filterName: (facet, active, value) =>
      look(active ? 'workItem.facet.filterRemove' : 'workItem.facet.filterAdd', {
        facet: look(`workItem.facet.name.${facet}`),
        value,
      }),
    say: (text) => ('literal' in text ? text.literal : look(text.key, text.params)),
  }
}
