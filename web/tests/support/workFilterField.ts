/**
 * The Work filter's field as the Work bar composes it — the shared field (`FacetFilter`) over the
 * Work adapter (`useWorkFilter`), the values drawn with their marks — as one component a spec can
 * mount with the bar's props and its `filter` model.
 */
import { computed, defineComponent, h } from 'vue'
import type { PropType } from 'vue'

import { useWorkFilter } from '@/features/work-filter/useWorkFilter.ts'

import FacetChoiceMark from '@/entities/work-item/components/FacetChoiceMark.vue'
import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import FacetFilter from '@/shared/ui/FacetFilter.vue'

export default defineComponent({
  props: {
    categories: {
      type: Array as PropType<readonly WorkItemBrief['state']['category'][]>,
      required: true,
    },
    filter: { type: Object as PropType<WorkFilter>, required: true },
    held: { type: Number as PropType<number | null>, default: null },
    items: { type: Array as PropType<readonly WorkItemBrief[]>, required: true },
  },
  emits: ['chips', 'find', 'update:filter'],
  setup(props, { emit }) {
    const filter = computed({
      get: () => props.filter,
      set: (next: WorkFilter) => emit('update:filter', next),
    })
    const work = useWorkFilter({
      categories: () => props.categories,
      filter,
      held: () => props.held,
      items: () => props.items,
    })
    return () =>
      h(
        FacetFilter,
        {
          'text': work.text.value,
          'onUpdate:text': (next: string) => {
            work.text.value = next
          },
          'chips': work.count.value,
          ...work.field.value,
          'source': work.source,
          'onChips': () => emit('chips'),
          'onChoose': work.choose,
          'onFind': (text: string) => emit('find', text),
          'onPick': work.pick,
          'onRemoveLast': work.removeLast,
        },
        {
          value: ({ option }: { option: { text: string; mark?: never } }) =>
            option.mark ? h(FacetChoiceMark, { mark: option.mark }) : option.text,
        },
      )
  },
})
