/**
 * How far out the camera may go on a phone-wide field: no further than the zoom at which a
 * card's smallest text still stands at the floor of the type ramp.
 *
 * On a wide field the camera goes out to the whole drawing, where cards turn into blocks of
 * their state's colour and the field reads as a map. A phone-wide field is about three
 * hundred pixels, so that map is a smudge of specks and the cards in it cannot be read;
 * there the camera stops where they can, and the operator pans to the rest.
 *
 * The floor is not a picked number. It is the type ramp's floor over the smallest text a
 * card draws, both read from the tokens the page runs on: the card writes its facts and its
 * state in `--font-detail` and `--font-line`, the smallest of its sizes, `--font-size-dense`;
 * and no text is set below `--font-size-meta` («Seven steps, and 12px is the floor»,
 * `DESIGN.md`). So at the floor a card's smallest text stands at 12px on the screen and its
 * title at 13. Not the reading floor of 13px over 13, the card's own size: a card 264px wide
 * with the 16px the keyboard keeps clear on each side then needs 296px, more than the field
 * a 390px window leaves, so every Tab into the field and every arrow moved the camera the
 * operator had placed. A card that took a smaller size, or a ramp that moved, moves the floor
 * with it, and the browser spec that measures a card's text at the floor says when the names
 * here no longer describe the card.
 */
import { GRAPH_ZOOM_MIN } from '@/widgets/work-item-graph/utils/graphLayout.ts'

/** The size of the smallest text a card draws: its facts and its state. */
const CARD_SMALLEST_TEXT = '--font-size-dense'

/** The least size of any text, the type ramp's floor. */
const TYPE_FLOOR = '--font-size-meta'

/**
 * Written as `1` on the flow by `GraphField` where the workspace is phone-wide, the one
 * place the field's width is told from a phone's: the same container width at which the
 * bar becomes one row and the controls give up their air.
 */
const PHONE_WIDE = '--graph-phone-wide'

/**
 * The zoom at which text drawn at `smallestText` stands at `typeFloor` on the screen;
 * no floor (`GRAPH_ZOOM_MIN`) when either is unknown.
 */
export function readingZoom(smallestText: number, typeFloor: number): number {
  return smallestText > 0 && typeFloor > 0 ? typeFloor / smallestText : GRAPH_ZOOM_MIN
}

/**
 * The floor for the field `flow` is: `readingZoom` of the tokens where the field is
 * phone-wide, else none. Read anew on every call, since a window that crosses the width
 * changes the field's size, which is what the camera recomputes on.
 */
export function fieldZoomFloor(flow: Element | null): number {
  if (!flow) return GRAPH_ZOOM_MIN
  const style = getComputedStyle(flow)
  if (style.getPropertyValue(PHONE_WIDE).trim() !== '1') return GRAPH_ZOOM_MIN
  const size = (name: string) => Number.parseFloat(style.getPropertyValue(name))
  return readingZoom(size(CARD_SMALLEST_TEXT), size(TYPE_FLOOR))
}
