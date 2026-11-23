/**
 * A work item's title, drawn on the element this sits on: code as code, each reference kept
 * from breaking at its hyphen, and the rest free to break after a `/` as well (`titleRuns`,
 * `textRuns.ts`). The element holds the title and nothing else; the surface sets its font, how it
 * wraps and where it ends in an ellipsis.
 *
 *     <strong v-work-item-title="item.title" class="tile-title" />
 *
 * A directive rather than a component: a title stands in every tile and every row of a list,
 * where a component instance each is a cost the board's budget refuses.
 */
import type { Directive } from 'vue'

import { titleRuns } from '@/shared/lib/titleRuns.ts'
import { drawRuns } from '@/shared/ui/textRuns.ts'

export const vWorkItemTitle: Directive<HTMLElement, string> = {
  beforeMount: (element, { value }) => drawRuns(element, titleRuns(value)),
  updated: (element, { value, oldValue }) => {
    if (value !== oldValue) drawRuns(element, titleRuns(value))
  },
}
