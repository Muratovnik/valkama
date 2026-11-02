/**
 * Give an element focus and bring it into view at the place it settles at.
 *
 * A scroll into view measures transforms, so an ancestor's glide in flight (the card's
 * body, as its head condenses) would bring the element in at the place it is passing
 * and leave it out of view once the glide ends. A focus move inside the card ends the
 * glide by itself, but the element may hold focus already, and then no focus move
 * happens. So what carries it finishes here.
 */
export function focusInView(target: HTMLElement) {
  for (const animation of document.getAnimations()) {
    const carried = animation.effect instanceof KeyframeEffect ? animation.effect.target : null
    if (carried && carried !== target && carried.contains(target)) animation.finish()
  }
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'nearest' })
}
