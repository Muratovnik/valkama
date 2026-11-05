/**
 * A short phrase that reads as one thing, a time above all, with its spaces made ones a line
 * does not break at. A time written into a sentence broke inside itself on a phone's card,
 * «05 нояб. 2026 г.,» ending one line and «23:47» starting the next; a line with no room for
 * it now takes it whole to the next one. Spaces only: the narrow one a locale may put before
 * «PM» already holds.
 */
export const unbroken = (text: string) => text.replaceAll(' ', '\u{A0}')
