/**
 * Words compared as the interface's language orders them. A comparison that names no language
 * takes the browser's, which need not be the interface's: a Russian interface in an English
 * browser stood Cyrillic names after Latin ones, and an English one in a Russian browser the
 * other way round. One collator a language serves the page.
 */
const collators = new Map<string, Intl.Collator>()

export function collatorOf(locale: string): Intl.Collator {
  let collator = collators.get(locale)
  if (collator === undefined) {
    collator = new Intl.Collator(locale)
    collators.set(locale, collator)
  }
  return collator
}
