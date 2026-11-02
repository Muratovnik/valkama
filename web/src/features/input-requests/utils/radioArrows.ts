const STEPS = new Map([
  ['ArrowDown', 1],
  ['ArrowRight', 1],
  ['ArrowUp', -1],
  ['ArrowLeft', -1],
])

/**
 * An arrow on a radio: the next one, round the ends, is focused and chosen, as the
 * browser's own arrows do, and a modified arrow stays the browser's (Alt+Left is Back).
 *
 * This is here for one difference. The browser scrolls the radio it moves to into the
 * middle of the view, 220px on a phone for a row one step on, and the card jumped under
 * whoever was reading it. The row comes into view by no more than it takes instead, at
 * its whole height, under whatever the scroller keeps over its top.
 */
export function moveRadioChoice(event: KeyboardEvent, rowSelector: string) {
  const step = STEPS.get(event.key)
  if (step === undefined || event.altKey || event.ctrlKey || event.metaKey) return
  const radio = event.target as HTMLInputElement
  const radios = [
    ...(radio.closest('fieldset')?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []),
  ]
  const next = radios.at((radios.indexOf(radio) + step) % radios.length)
  if (!next) return
  event.preventDefault()
  next.focus({ preventScroll: true })
  next.click()
  next.closest(rowSelector)?.scrollIntoView({ block: 'nearest' })
}
