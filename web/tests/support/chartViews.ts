/**
 * A chart's own switch between its drawings and its table, pressed as a reader presses it: «Ring»,
 * «Bars», «Chart» or «Table» in the switch of the section `section` finds.
 */
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'

/** Presses `label` in the view switch of the section `section` finds inside `host`. */
export async function showView(
  host: Pick<VueWrapper, 'findAll'> | Pick<DOMWrapper<Element>, 'findAll'>,
  section: string,
  label: string,
) {
  const option = host.findAll(`${section} .segmented-option`).find((one) => one.text() === label)
  if (!option) throw new Error(`${section} offers no ${label}`)
  await option.trigger('click')
}

/** The views the switch of the section `section` finds offers, and the one it shows. */
export function viewsOf(
  host: Pick<VueWrapper, 'findAll'> | Pick<DOMWrapper<Element>, 'findAll'>,
  section: string,
) {
  const options = host.findAll(`${section} .segmented-option`)
  return {
    offered: options.map((one) => one.text()),
    shown: options.find((one) => one.attributes('aria-checked') === 'true')?.text(),
  }
}
