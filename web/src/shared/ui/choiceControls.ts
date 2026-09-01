export type ControlIconName =
  | 'language'
  | 'vscode'
  | 'terminal'
  | 'command'
  | 'cursor'
  | 'codex'
  | 'claude'
  | 'client'
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
