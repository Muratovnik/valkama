/**
 * A menu's options over the values of a facet, from the registry the chosen value is drawn
 * from. The card's state and priority, the new task's kind and priority and the filter's
 * kinds, priorities and states each built their own list of words, and none of them drew
 * the glyph or the dot its button showed: a value read one way in the button and another in
 * the list under it. Each option carries its mark for the host to draw, its word as its
 * label, and what it means as its note where the registry says that.
 */
import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import { choiceMark } from '@/entities/work-item/utils/facets.ts'
import type { FacetChoice, FacetMark } from '@/entities/work-item/utils/facets.ts'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'

export interface FacetChoiceOption extends ChoiceOption {
  mark: FacetMark
}

export function useFacetChoices() {
  const words = useMarkWords()
  return (choices: readonly FacetChoice[]): FacetChoiceOption[] =>
    choices.map((choice) => {
      const mark = choiceMark(choice)
      const meaning = mark.hint ? { description: words.say(mark.hint) } : {}
      return { value: choice.value, label: words.say(mark.text), mark, ...meaning }
    })
}
