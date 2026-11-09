/**
 * What a menu holds (`VMenu`): actions, on/off settings and one-of-a-few choices, in the
 * order the host lists them. Each entry says what a choice of it does; the menu closes
 * after any of them, as a menu does.
 *
 * - `action` does something once: `menuitem`.
 * - `toggle` turns one thing on or off and shows which: `menuitemcheckbox`, a check when on.
 * - `choice` picks one value of a few under its own caption: a group of `menuitemradio`,
 *   set apart from what stands before it by a rule.
 */
export type MenuEntry =
  | {
      key: string
      kind: 'action'
      label: string
      disabled?: boolean
      icon?: string
      select: () => void
    }
  | {
      checked: boolean
      key: string
      kind: 'toggle'
      label: string
      disabled?: boolean
      icon?: string
      select: (checked: boolean) => void
    }
  | {
      key: string
      kind: 'choice'
      /** The caption over the values, which names what they choose. */
      label: string
      options: readonly { label: string; value: string; icon?: string }[]
      value: string
      select: (value: string) => void
    }
