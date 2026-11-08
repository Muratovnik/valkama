/**
 * What the window's one tooltip says over an element, where its `title` used to say it.
 *
 * Takes the element or a test-utils wrapper of one; an absent one has no hint.
 */
import { tooltipOf } from '@/shared/ui/tooltipAnchors.ts'

export function hintOf(target: Element | { element: Element } | null | undefined) {
  const element = target instanceof Element ? target : target?.element
  return element ? tooltipOf(element)?.text : undefined
}
