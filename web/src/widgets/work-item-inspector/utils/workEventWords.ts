/**
 * What the lines of the work model's events say to a reader, by the shapes the service writes
 * them in: an acceptance's basis (`inherited`, `label_rule: docs`), work put off until a day or a
 * card's close (`until 2026-12-01: why`, `until MAIN-12`), and why it came back (`date
 * 2026-12-01`, `completed MAIN-12`), a triage review's mark (`seen`, `cleared`), a card that left
 * for another goal (`MAIN-12: moved under MAIN-3`), a part split off (`MAIN-15: 2 steps`) and a
 * change of kind (`task -> stage; leftover MAIN-15: 2 steps; projects dropped: alpha`).
 *
 * A line of any other shape, and a part of one the service never words — an agent's reason, a
 * label, a reference — is said as recorded.
 */

/** `t` with the count a plural form is chosen by. */
export type CountedTranslate = (
  key: string,
  values?: Record<string, unknown>,
  plural?: number,
) => string

const REFERENCE = /^[A-Z][A-Z\d]{1,7}-[1-9]\d{0,8}$/u
const BASES = new Set(['owner', 'assignment', 'inherited', 'label_rule', 'agent', 'migrated'])
const KINDS = new Set(['task', 'bug', 'improvement', 'goal', 'stage'])
const CAME = new Set(['completed', 'cancelled', 'deleted'])

/** `basis` or `basis: label`, as an acceptance writes it. */
export function acceptedWords(detail: string, t: CountedTranslate) {
  const [, basis = '', label] = /^([a-z_]+)(?:: ([\s\S]+))?$/u.exec(detail) ?? []
  if (!BASES.has(basis)) return detail
  const word = t(`workItem.facts.basis.${basis}`)
  return label ? t('history.event.byLabel', { basis: word, label }) : word
}

/**
 * `until X` or `until X: why`, as a move into the put-off state notes it: until a card's close
 * when X is a reference, until a day or a time otherwise. Null for a note of another shape.
 */
export function untilWords(
  note: string,
  t: CountedTranslate,
  day: (value: string) => string,
): string | null {
  const [, until = '', why = ''] = /^until (\S+)(?:: ([\s\S]*))?$/u.exec(note) ?? []
  if (!until) return null
  const said = REFERENCE.test(until)
    ? t('workItem.closeActions.deferred.card', { reference: until })
    : t('workItem.closeActions.deferred.day', { date: day(until) })
  return why.trim() ? t('history.event.why', { until: said, why: why.trim() }) : said
}

/**
 * A note the service writes for a move or an opening it makes itself: a claim, a failed launch,
 * an acceptance with the goal above, a merge into a survivor, a change of kind and a move out of a
 * goal. Null for a note of another shape, which is a writer's own.
 */
export function serviceNoteWords(note: string, t: CountedTranslate): string | null {
  if (note === 'claimed') return t('history.event.claimed')
  if (note === 'launch_failed') return t('history.event.launchFailed')
  const [, kind = ''] = /^converted from an? ([a-z]+)$/u.exec(note) ?? []
  if (KINDS.has(kind)) return t('history.event.convertedFrom', { kind: t(`workItem.kind.${kind}`) })
  const [, said = '', reference = ''] = /^(accepted with|duplicate of) (\S+)$/u.exec(note) ?? []
  if (REFERENCE.test(reference))
    return t(
      said === 'accepted with' ? 'history.event.acceptedWith' : 'history.event.duplicateOf',
      {
        reference,
      },
    )
  const [, left = '', why = ''] = /^moved out of (\S+): ([\s\S]+)$/u.exec(note) ?? []
  return REFERENCE.test(left) ? t('history.event.movedOut', { reference: left, why }) : null
}

/** `date 2026-12-01`, or `completed MAIN-12` and the like, as work that came back says why. */
export function returnedWords(detail: string, t: CountedTranslate, day: (value: string) => string) {
  const [, because = '', what = ''] = /^([a-z]+) (\S+)$/u.exec(detail) ?? []
  if (because === 'date') return t('history.event.cameDay', { date: day(what) })
  if (CAME.has(because) && REFERENCE.test(what))
    return t(`history.event.cameCard.${because}`, { reference: what })
  return detail
}

/** `seen` or `cleared`, as a triage review's mark writes it. */
export function triageWords(detail: string, t: CountedTranslate) {
  return detail === 'seen' || detail === 'cleared' ? t(`history.event.${detail}`) : detail
}

/** `MAIN-12: why`; the service's own why, `moved under MAIN-3`, in words, an agent's as written. */
export function childLeftWords(detail: string, t: CountedTranslate) {
  const [, reference = '', goal = ''] = /^(\S+): moved under (\S+)$/u.exec(detail) ?? []
  return REFERENCE.test(reference) && REFERENCE.test(goal)
    ? t('history.event.movedUnder', { reference, goal })
    : detail
}

/** `MAIN-15: 2 steps`, as the part a split took writes it on the task. */
export function splitWords(detail: string, t: CountedTranslate) {
  const [, reference = '', count] = /^(\S+): (\d+) steps$/u.exec(detail) ?? []
  if (!REFERENCE.test(reference) || count === undefined) return detail
  const n = Number(count)
  return t('history.event.conditions', { reference, n }, n)
}

/** One part of a change of kind's line in words, or null when its shape is not known. */
function convertedPart(part: string, t: CountedTranslate): string | null {
  const [, was = '', became = ''] = /^([a-z]+) -> ([a-z]+)$/u.exec(part) ?? []
  const kind = (key: string) => t(`workItem.kind.${key}`)
  if (KINDS.has(was) && KINDS.has(became)) return `${kind(was)} → ${kind(became)}`
  const [, reference = '', count] = /^leftover (\S+): (\d+) steps$/u.exec(part) ?? []
  if (REFERENCE.test(reference) && count !== undefined) {
    const n = Number(count)
    return t('history.event.leftover', { reference, n }, n)
  }
  const [, projects] = /^projects dropped: ([\s\S]+)$/u.exec(part) ?? []
  return projects === undefined ? null : t('history.event.projectsDropped', { projects })
}

/** `task -> stage`, then the leftover and the projects dropped, each part in words. */
export function convertedWords(detail: string, t: CountedTranslate) {
  const parts = detail.split('; ').map((part) => convertedPart(part, t))
  return parts.every((part) => part !== null) ? parts.join('; ') : detail
}
