/** A stop, a question or exclamation mark or an ellipsis, with any closing quotes or brackets after it. */
const SENTENCE_END = /[.!?…]["'»”’)\]]*$/u
/** The same, or a colon: a label that ends so needs no colon of ours after it. */
const LABEL_END = /[.!?…:]["'»”’)\]]*$/u

/** Whether a text ends its own sentence, as a person's or an agent's words often do. */
export function endsSentence(text: string): boolean {
  return SENTENCE_END.test(text.trimEnd())
}

/**
 * Sentences said one after another, each closed by a full stop, as a hint or an accessible name
 * reads several lines of a screen. A sentence that already ends in a stop of its own keeps it and
 * takes no second one: a period named by its days ends in a month cut short, «2–5 нояб.», and
 * «к периоду 2–5 нояб.» followed by a sentence read «нояб..». Empty sentences are left out. The
 * last sentence stays open, as a hint's last line does, unless `closed`, as a name said whole is.
 */
export function sentences(
  parts: readonly (string | null | undefined)[],
  { closed = false }: { closed?: boolean } = {},
): string {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .map((part, index, all) =>
      (closed || index < all.length - 1) && !endsSentence(part) ? `${part}.` : part,
    )
    .join(' ')
}

/**
 * A label as it stands before what it names on one line: with a colon after it, «Цвет: », or
 * with a space alone when it ends in a mark of its own. An agent's label is often a question,
 * «Какой вариант аналитики?», and a colon after it read «аналитики?: Фон строки».
 */
export function labelHead(label: string): string {
  const head = label.trimEnd()
  return LABEL_END.test(head) ? `${head} ` : `${head}: `
}

/** A label and what it names on one line, «Цвет: синий» (`labelHead`). */
export function labelled(label: string, text: string): string {
  return `${labelHead(label)}${text}`
}
