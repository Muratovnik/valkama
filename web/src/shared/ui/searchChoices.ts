/**
 * What `SearchCombobox` lists for what was typed, and how its values travel through Reka.
 *
 * Reka keeps '' for "nothing chosen", and an option may mean nothing by it ("no epic"),
 * so every value reaches Reka as a token; typed words offered as a new value are a token
 * of their own kind, which no option can spell.
 */
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'

const VALUE = 'v:'
const NEW = 'n:'

export const choiceToken = (value: string) => `${VALUE}${value}`
export const freshToken = (words: string) => `${NEW}${words}`

/** The value a token stands for: an option's, or the typed words. */
export function tokenValue(token: string): string {
  return token.startsWith(NEW) ? token.slice(NEW.length).trim() : token.slice(VALUE.length)
}

export interface SearchedChoices {
  /** The options that answer the query, in the host's order. */
  found: ChoiceOption[]
  /** The typed words when they may be added as a value: no option says them already. */
  fresh: string
}

/**
 * The options whose words or note hold the query, ignoring case, and the typed words
 * as a new value when they may be one. A chosen value the options do not have — one
 * added here and not yet written — is listed after them, so it can be taken out again.
 */
export function searchChoices(input: {
  chosen: readonly string[]
  /** Typed words may be added as a value. */
  creatable: boolean
  options: readonly ChoiceOption[]
  query: string
  several: boolean
}): SearchedChoices {
  const known = new Set(input.options.map((option) => option.value))
  const listed: ChoiceOption[] = [
    ...input.options,
    ...(input.several
      ? input.chosen.filter((value) => !known.has(value)).map((value) => ({ value, label: value }))
      : []),
  ]
  const words = input.query.trim()
  const needle = words.toLocaleLowerCase()
  const found = needle
    ? listed.filter((option) =>
        `${option.label} ${option.description ?? ''}`.toLocaleLowerCase().includes(needle),
      )
    : listed
  const said = listed.some((option) => option.label.toLocaleLowerCase() === needle)
  return { found, fresh: input.creatable && words && !said ? words : '' }
}
