/**
 * The first cell of a list row: the kind's glyph in a slot of its own, in a
 * tree the row's indent and its arrow (`TreeRowLead`), the reference, which
 * opens the card, and where the priority's column has folded away the
 * priority's glyph after it.
 *
 * It is drawn from the list's own render as plain elements, as the row's marks
 * are (`drawMarks.ts`), not as a component: a component here was a second
 * instance in every row, a thousand more on a space of a thousand rows, for a
 * cell that holds no state of its own. Its look is `listRefCell.css` for the
 * same reason.
 *
 * The glyphs are the list's (`useListRuns.ts`) and take their slot's class
 * here, so the kind's slot keeps its width where it holds no glyph and every
 * reference starts where the one above it does. In a flat list the reference is
 * the row's one stop for the keyboard; in a tree the row is, and the cell takes
 * focus only from the keys.
 */
import { cloneVNode, h } from 'vue'
import type { VNode } from 'vue'

import '@/widgets/work-item-views/components/listRefCell.css'
import type { useListTreeRows } from '@/widgets/work-item-views/composables/useListTreeRows.ts'

import type { FacetId } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import TreeRowLead from '@/shared/ui/TreeRowLead.vue'
import type { useListKeys } from '@/shared/ui/useListKeys.ts'

interface RefCellList {
  keys: Pick<ReturnType<typeof useListKeys>, 'tabStop' | 'toggle'>
  tree: Pick<ReturnType<typeof useListTreeRows>, 'cellTab' | 'isTree' | 'refId' | 'treeLead'>
  /** Whether the priority's glyph follows the reference: its column has folded away. */
  after: () => boolean
  /** Draws an item's glyph of a facet. */
  glyph: (item: WorkItemBrief, facet: FacetId) => VNode
}

/** Draws a row's first cell, for a list whose keys and tree these are. */
export function listRefCell({ after, glyph, keys, tree }: RefCellList) {
  return (item: WorkItemBrief): VNode => {
    const lead = tree.treeLead(item)
    const id = item.work_item_id
    return h('td', { class: 'list-ref-cell', tabindex: tree.cellTab }, [
      cloneVNode(glyph(item, 'kind'), { class: 'list-slot' }),
      lead &&
        h(TreeRowLead, {
          class: 'list-lead',
          depth: lead.depth,
          expanded: lead.expanded,
          levels: lead.levels,
          name: item.reference,
          onToggle: () => keys.toggle(id),
        }),
      h(
        'button',
        {
          'id': tree.refId(item),
          'type': 'button',
          'class': 'list-open',
          'tabindex': tree.isTree ? -1 : keys.tabStop(id),
          'data-id': id,
          'data-reference': item.reference,
        },
        item.reference,
      ),
      after() ? cloneVNode(glyph(item, 'priority'), { class: 'list-after' }) : null,
    ])
  }
}

interface GroupCellList {
  keys: Pick<ReturnType<typeof useListKeys>, 'toggle'>
  tree: Pick<
    ReturnType<typeof useListTreeRows>,
    'cellTab' | 'groupCounts' | 'matchingOf' | 'nameId' | 'treeLead'
  >
  /** How many columns the list shows, which the group's one cell spans. */
  columns: () => number
}

/**
 * A group's row as one cell across the columns (`listGroups.ts`): its arrow, its
 * name and what it counts, as a lane's heading says them. It has no reference, so the
 * kind's slot stays empty and the name starts where a card's reference does.
 */
export function listGroupCell({ columns, keys, tree }: GroupCellList) {
  return (item: WorkItemBrief): VNode => {
    const lead = tree.treeLead(item)
    const id = item.work_item_id
    const matching = tree.matchingOf(item)
    return h('td', { class: 'list-group-cell', colspan: columns(), tabindex: tree.cellTab }, [
      h('span', { class: 'list-slot' }),
      lead &&
        h(TreeRowLead, {
          class: 'list-lead',
          depth: lead.depth,
          expanded: lead.expanded,
          levels: lead.levels,
          name: item.title,
          onToggle: () => keys.toggle(id),
        }),
      h('span', { id: tree.nameId(item), class: 'list-group-name' }, item.title),
      h('span', { class: 'list-group-counts' }, tree.groupCounts(item)),
      matching ? h('span', { class: 'list-group-counts' }, matching) : null,
    ])
  }
}
