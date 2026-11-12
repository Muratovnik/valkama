/**
 * What a live region is made to say, in order: each text it takes, once in a row. A wait said
 * once reads as one entry between the blanks that clear it, so a test tells one announcement
 * from two by the entries, whatever the timers did in between.
 */
export function saidBy(region: Element): string[] {
  const said: string[] = []
  const take = () => {
    const text = region.textContent?.trim() ?? ''
    if (said.at(-1) !== text) said.push(text)
  }
  take()
  new MutationObserver(take).observe(region, {
    characterData: true,
    childList: true,
    subtree: true,
  })
  return said
}
