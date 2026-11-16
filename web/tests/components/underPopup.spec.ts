import { afterEach, describe, expect, it } from 'vitest'

import { underPopup } from '@/shared/ui/overlayStack.ts'

/** A floating content as Reka draws one, in its wrapper, holding one row. */
function floating(role: string | null, data: Record<string, string> = {}) {
  const wrapper = document.createElement('div')
  wrapper.dataset.rekaPopperContentWrapper = ''
  const content = document.createElement('div')
  Object.assign(content.dataset, data)
  if (role) content.setAttribute('role', role)
  const row = document.createElement('button')
  content.append(row)
  wrapper.append(content)
  document.body.append(wrapper)
  return row
}

function outside() {
  const element = document.createElement('button')
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('an element under an open popup', () => {
  it('is nothing while no popup is open', () => {
    expect(underPopup(outside())).toBe(false)
  })

  it('is any element outside an open menu, and none of the menu’s own rows', () => {
    const element = outside()
    const row = floating('menu', { state: 'open' })
    expect(underPopup(element)).toBe(true)
    expect(underPopup(row)).toBe(false)
  })

  it('counts floating content that says no state, and not one on its way out', () => {
    const element = outside()
    floating('listbox')
    expect(underPopup(element)).toBe(true)
    document.body.replaceChildren(element)
    floating('menu', { state: 'closed' })
    expect(underPopup(element)).toBe(false)
  })

  it('takes no hint, nor a reference’s card, for a popup', () => {
    const element = outside()
    floating(null, { hintSurface: '', state: 'open' })
    expect(underPopup(element)).toBe(false)
  })

  it('takes a panel a press pinned open for one', () => {
    const element = outside()
    const panel = document.createElement('div')
    panel.dataset.popupSurface = ''
    const inside = document.createElement('a')
    panel.append(inside)
    document.body.append(panel)
    expect(underPopup(element)).toBe(true)
    expect(underPopup(inside)).toBe(false)
  })
})
