import { defineComponent, ref } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DOCUMENT_PANE_DEFAULT_WIDTH,
  DOCUMENT_PANE_STORAGE_KEY,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
} from '@/shared/lib/shellLayout.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import ResizableInspector from '@/shared/ui/ResizableInspector.vue'

/**
 * A document opens over what it was opened from: a drawer on the command layer, over a
 * card on the drawer layer and over a dialog on the command layer. What it covers must
 * stay mounted, with a draft typed into it, and Escape must close the document alone.
 */

const mounted: ReturnType<typeof mount>[] = []

afterEach(async () => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  await flushPromises()
  localStorage.removeItem(DOCUMENT_PANE_STORAGE_KEY)
  document.body.style.overflow = ''
})

const DOCUMENT = `
  <ResizableInspector
    :open="document"
    label="Document"
    layer="command"
    surface-class="document-drawer"
    storage-key="${DOCUMENT_PANE_STORAGE_KEY}"
    :default-width="${DOCUMENT_PANE_DEFAULT_WIDTH}"
    :min-width="${DRAWER_MIN_WIDTH}"
    :max-width="${DRAWER_MAX_WIDTH}"
    @close="document = false"
  ><button class="document-action">Back</button></ResizableInspector>`

function host(under: string) {
  const below = ref(true)
  const document = ref(false)
  const wrapper = mount(
    defineComponent({
      components: { DialogFrame, ResizableInspector },
      setup: () => ({ below, document }),
      template: `${under}${DOCUMENT}`,
    }),
    { attachTo: globalThis.document.body },
  )
  mounted.push(wrapper)
  return { below, document }
}

const CARD = `
  <ResizableInspector :open="below" label="Card" @close="below = false">
    <textarea class="draft" aria-label="Reply"></textarea>
    <button class="opener" @click="document = true">docs/plan.md</button>
  </ResizableInspector>`

const QUESTIONS = `
  <DialogFrame :open="below" title="Waiting for my answer" close-label="Close" @close="below = false">
    <textarea class="draft" aria-label="Reply"></textarea>
    <button class="opener" type="button" @click="document = true">docs/plan.md</button>
  </DialogFrame>`

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

function escape(target: HTMLElement) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
}

describe.each([
  ['a card', CARD, '.overlay-layer-drawer'],
  ['the questions waiting for an answer', QUESTIONS, '.overlay-layer-command'],
])('a document drawer over %s', (_name, under, coveredHost) => {
  it('covers it, keeps its draft, and closes alone on Escape back to the link', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    const state = host(under)
    await flushPromises()
    const draft = element<HTMLTextAreaElement>('.draft')
    draft.value = 'Half an answer'
    const opener = element<HTMLButtonElement>('.opener')
    opener.focus()
    opener.click()
    await flushPromises()

    const drawer = element('.document-drawer')
    expect(drawer.closest('.overlay-host')?.classList).toContain('overlay-layer-command')
    expect(drawer.getAttribute('role')).toBe('dialog')
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    const covered = element(`${coveredHost} .overlay-surface:not(.document-drawer)`)
    expect(covered.hasAttribute('inert')).toBe(true)
    expect(drawer.contains(document.activeElement)).toBe(true)
    expect(element('.document-drawer [role="separator"]').getAttribute('aria-valuenow')).toBe(
      String(DOCUMENT_PANE_DEFAULT_WIDTH),
    )

    escape(element('.document-action'))
    await flushPromises()
    expect(state.document.value).toBe(false)
    expect(state.below.value).toBe(true)
    expect(document.querySelector('.document-drawer')).toBeNull()
    expect(covered.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(opener)
    expect(element<HTMLTextAreaElement>('.draft').value).toBe('Half an answer')
  })
})
