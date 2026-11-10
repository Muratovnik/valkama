/**
 * What a menu holds (`VMenu`): actions, on/off settings and one-of-a-few choices, in the
 * order the host lists them. Each entry says what a choice of it does; the menu closes
 * after any of them, as a menu does.
 *
 * - `action` does something once: `menuitem`. One that `opens` what takes focus next, such
 *   as a dialog, runs once the menu has gone, with focus already back on the menu's button.
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
      /**
       * Choosing it opens something that takes focus, a dialog: what it opens gives focus
       * back to the menu's button when it closes, and the menu does not take it from there.
       */
      opens?: boolean
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
