/**
 * Which references on the page show a preview, for the one preview of the window.
 *
 * A popup per reference cost more to mount than a long report can afford, so a
 * reference carries nothing but this directive: it files what the reference shows
 * and marks the element, and `ReferencePreview` finds the element under the pointer
 * or the focus from listeners of its own. The mark is also what the popup library's
 * hover rule reads to let the pointer cross from one reference to another.
 */
import type { Directive } from 'vue'

import type { ReferencePreview } from '@/shared/lib/referenceLinks.ts'

const previews = new WeakMap<Element, ReferencePreview>()
let gone: ((element: HTMLElement) => void) | null = null

function file(element: HTMLElement, preview: ReferencePreview | undefined) {
  if (preview) previews.set(element, preview)
  else previews.delete(element)
  element.toggleAttribute('data-reference-preview', Boolean(preview))
  element.toggleAttribute('data-grace-area-trigger', Boolean(preview))
  if (!preview) gone?.(element)
}

export const vReferencePreview: Directive<HTMLElement, ReferencePreview | undefined> = {
  mounted: (element, { value }) => file(element, value),
  updated: (element, { value }) => file(element, value),
  unmounted: (element) => gone?.(element),
}

/** The reference an event happened on, if it shows a preview. */
export function previewAnchorOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest('[data-reference-preview]') : null
}

export const previewOf = (element: HTMLElement) => previews.get(element)

/** Hear of a reference that stopped showing a preview, or left the page; returns the undo. */
export function onPreviewAnchorGone(listen: (element: HTMLElement) => void): () => void {
  gone = listen
  return () => {
    gone = null
  }
}
