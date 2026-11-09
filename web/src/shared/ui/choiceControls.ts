export type ControlIconName =
  | 'language'
  | 'vscode'
  | 'editor'
  | 'terminal'
  | 'command'
  | 'cursor'
  | 'codex'
  | 'claude'
  | 'client'
  | 'last-place'
  | 'off'
  | 'memory'
  | 'board'
  | 'skills'
  | 'search'
  | 'check'
  | 'chevron'

export interface ChoiceOption {
  label: string
  value: string
  description?: string
  disabled?: boolean
  icon?: ControlIconName
  /** A hover hint on the option and on the chosen value; it is not drawn. */
  title?: string
}

export interface ChoiceValueCodec {
  readonly tokenToValue: ReadonlyMap<string, string>
  readonly valueToToken: ReadonlyMap<string, string>
}

/** Reka reserves '' for unset, while product filters legitimately use it. */
export function choiceValueCodec(
  options: readonly Pick<ChoiceOption, 'value'>[],
): ChoiceValueCodec {
  const valueToToken = new Map<string, string>()
  const tokenToValue = new Map<string, string>()
  for (const option of options) {
    if (valueToToken.has(option.value)) continue
    const token = `choice:${encodeURIComponent(option.value)}`
    valueToToken.set(option.value, token)
    tokenToValue.set(token, option.value)
  }
  return { valueToToken, tokenToValue }
}

export function encodeChoiceValue(codec: ChoiceValueCodec, value: string): string | null {
  return codec.valueToToken.get(value) ?? null
}

export function decodeChoiceValue(codec: ChoiceValueCodec, token: string): string | null {
  return codec.tokenToValue.get(token) ?? null
}

/** One row of a grouped list (`OptionGroups`). */
export interface OptionRow {
  key: string
  text: string
  detail?: string
  /** The glyph in the check's place, for a row that does something rather than choose. */
  icon?: string
  /** What a screen reader says of the row where its word alone says too little; it starts with the word. */
  name?: string
  /** The row leads to a list of its own, and says so with a chevron at its end. */
  next?: boolean
  /** Absent for a row that is no value, which a press does not choose but follows. */
  selected?: boolean
}

/** A named group of rows in a grouped list (`OptionGroups`). */
export interface OptionGroup<Row> {
  id: string
  name: string
  options: readonly Row[]
  /** The group's name is a row too, the way back to the list this one was opened from. */
  back?: { key: string; name: string }
  /** No head: the group's rows say what they are, and its name labels it for a screen reader. */
  bare?: boolean
  choices?: readonly {
    key: string
    name: string
    selected: boolean
    text: string
    title: string
  }[]
}

/** The id of an option in a grouped list (`OptionGroups`), by its place in reading order. */
export const optionGroupItemId = (listId: string, place: number) => `${listId}-${place}`
