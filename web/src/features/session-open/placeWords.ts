/**
 * The words for where a session is open, what a click did and why it did not:
 * one source for a button's place label, an outcome's notice and a refusal.
 * Every phrase is the dictionary's (`open.*`); nothing here passes an error's
 * own text through.
 */

import type { Outcome, Refusal } from '@/features/session-open/openPlan.ts'

import type { OpenStep } from '@/shared/api/openPlanModel.ts'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** A place as the server names one: the host when there is one, else how it is open. */
export interface PlaceName {
  opened_host: string
  opened_in: string
}

/** The dictionary key of a place's word, or `''` for a place nobody recorded. */
export function placeKey(place: PlaceName): string {
  const word = place.opened_host || place.opened_in
  return word ? `open.place.${word}` : ''
}

/** What a button for one step says. */
export function actionKey(step: OpenStep): string {
  return step.kind === 'explain' ? '' : `open.action.${step.kind}`
}

function refusalWords(t: Translate, refusal: Refusal): string {
  if (refusal.reason === 'path-refused' && refusal.code)
    return t(`open.pathRefused.${refusal.code}`)
  if (refusal.reason === 'not-installed' && refusal.host) {
    const place = t(placeKey({ opened_in: '', opened_host: refusal.host }))
    return t('open.refused.not-installed', { place })
  }
  const words = t(`open.refused.${refusal.reason}`)
  return refusal.reason === 'gone' && refusal.archived ? `${words} ${t('open.archived')}` : words
}

/** The one line a notice area shows for an outcome. */
export function outcomeWords(t: Translate, outcome: Outcome): string {
  if (outcome.status === 'refused') return refusalWords(t, outcome.refusal)
  if (outcome.status === 'copied') return t('open.outcome.copied')
  // A notice before the next action says more than "now the next one".
  if (outcome.status === 'next')
    return outcome.notice ? refusalWords(t, outcome.notice) : t('open.outcome.next')
  const key = outcome.opens ? placeKey(outcome.opens) : ''
  return key ? t('open.outcome.opened', { place: t(key) }) : t('open.outcome.openedPlain')
}
