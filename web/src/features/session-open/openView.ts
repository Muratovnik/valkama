/**
 * What a session's button says before any click: where the session opens, in what
 * state, and why when the reader could not guess. The card's read gives the first
 * answer at once; the server's plan, read beside it, is the one that holds, because
 * it alone knows what a row older than the place record comes to, what is installed
 * here and whether a client still keeps the session. A click still plans for itself.
 *
 * | The plan or the record says | The button says | A press |
 * | --- | --- | --- |
 * | a place that opens | the place | opens it |
 * | no place known | the place it falls back to, and why | opens there |
 * | a place from the row's first open | the place, and so | opens there |
 * | the owner's "always open in" | the place and "by your setting" | opens there |
 * | running in a terminal | «Терминал · идёт» | shows why, and where to look |
 * | running with no window | «Без окна · идёт» | is no button |
 * | a client that lost it, or anything else that opens nothing | why, in the quiet ink | is no button |
 */

import { planRefusal } from '@/features/session-open/openPlan.ts'
import type { Refusal } from '@/features/session-open/openPlan.ts'
import { placeKey, refusalWords, whereWords } from '@/features/session-open/placeWords.ts'
import type { PlaceName, Translate } from '@/features/session-open/placeWords.ts'

import type { Executor } from '@/shared/api/executorModel.ts'
import type { OpenPlace, OpenPlan } from '@/shared/api/openPlanModel.ts'
import type { AlwaysChoice } from '@/shared/lib/settings.ts'

export interface OpenFacts {
  /** What the card's read says; absent where a surface's read names no holder. */
  executor?: Pick<Executor, 'opened_host' | 'opened_in' | 'state'> | null
  /** The session family's settings, once the family is known. */
  opening?: { always: AlwaysChoice; fallback: OpenPlace } | null
  /** What the server would do now, once it has answered. */
  plan?: OpenPlan | null
}

export interface OpenView {
  /** Why it opens there or does not open; empty where the place says it all. */
  hint: string
  /** Whether a press does anything. */
  pressable: boolean
  /** A press shows where it runs and what can be done, rather than opening it. */
  running: boolean
  /** The owner's "always open in" decided this. */
  setting: boolean
  /** The state worth saying beside the place; only running is. */
  state: string
  /** Glyph for a place that is a terminal. */
  terminal: boolean
  /** The place's word, or what stands instead of one; empty until something is known. */
  text: string
  /** The phrase for being there, for a sentence; empty until a place is known. */
  where: string
}

const NO_VIEW = {
  hint: '',
  pressable: true,
  running: false,
  setting: false,
  state: '',
  terminal: false,
  text: '',
  where: '',
} satisfies OpenView

function atPlace(t: Translate, place: PlaceName, live: boolean, extra: Partial<OpenView> = {}) {
  const key = placeKey(place)
  return {
    ...NO_VIEW,
    state: live ? t('open.state.live') : '',
    terminal: place.opened_in === 'terminal',
    text: key ? t(key) : '',
    where: key ? whereWords(t, place) : '',
    ...extra,
  }
}

/** No button: the words instead of a place, and the reason as its hint. */
function stands(text: string, hint: string): OpenView {
  return { ...NO_VIEW, hint, pressable: false, text }
}

/** Short enough to stand where a place's word would. */
function cannotWords(t: Translate, refusal: Refusal): string {
  if (refusal.reason === 'not-installed' && refusal.host)
    return t('open.cannot.not-installed', {
      place: t(placeKey({ opened_in: '', opened_host: refusal.host })),
    })
  return t(`open.cannot.${refusal.reason}`)
}

const PLACE_OF_SETTING: Record<OpenPlace, PlaceName> = {
  'vscode': { opened_in: 'ide', opened_host: 'vscode' },
  'vscode-insiders': { opened_in: 'ide', opened_host: 'vscode-insiders' },
  'cursor': { opened_in: 'ide', opened_host: 'cursor' },
  'windsurf': { opened_in: 'ide', opened_host: 'windsurf' },
  'terminal': { opened_in: 'terminal', opened_host: '' },
  'claude-desktop': { opened_in: 'app', opened_host: 'claude-desktop' },
  'codex-app': { opened_in: 'app', opened_host: 'codex-app' },
}

function bySetting(t: Translate, place: PlaceName, live: boolean): OpenView {
  const where = whereWords(t, place)
  return atPlace(t, place, live, {
    setting: true,
    hint: t('open.hint.always', { where }),
  })
}

function fromPlan(t: Translate, plan: OpenPlan, live: boolean): OpenView {
  const explained = plan.steps.some((step) => step.kind === 'explain') ? planRefusal(plan) : null
  const { opens, place } = plan
  // What a press can only explain, whether or not there is somewhere to look at it.
  if (explained?.reason === 'live-in-terminal')
    return atPlace(t, place, live, { hint: refusalWords(t, explained), running: true })
  if (!opens) {
    const refusal = explained ?? { reason: 'no-session' as const }
    return stands(cannotWords(t, refusal), refusalWords(t, refusal))
  }
  if (opens.source === 'always') return bySetting(t, opens, live)
  const where = whereWords(t, opens)
  if (opens.source === 'fallback') {
    let hint = t('open.hint.elsewhere', { where })
    if (place.source === 'none') hint = t('open.hint.unknown', { where })
    else if (opens.missed)
      hint = t('open.hint.missed', {
        place: t(placeKey({ opened_in: '', opened_host: opens.missed })),
        where,
      })
    return atPlace(t, opens, live, { hint })
  }
  const hint = place.first_open ? t('open.hint.firstOpen') : ''
  return atPlace(t, opens, live, { hint })
}

function fromRecord(t: Translate, facts: OpenFacts, live: boolean): OpenView {
  const { executor, opening } = facts
  if (opening?.always)
    return opening.always === 'custom'
      ? { ...NO_VIEW, setting: true, hint: t('open.hint.command'), text: t('open.settings.custom') }
      : bySetting(t, PLACE_OF_SETTING[opening.always], live)
  const recorded = executor && executor.opened_in !== 'headless' && executor.opened_in !== ''
  if (recorded) {
    const holding = live && executor.opened_in === 'terminal'
    const hint = holding ? refusalWords(t, { reason: 'live-in-terminal' }) : ''
    return atPlace(t, executor, live, { hint, running: holding })
  }
  if (!opening) return { ...NO_VIEW, state: live ? t('open.state.live') : '' }
  const fallback = PLACE_OF_SETTING[opening.fallback]
  const hint = t('open.hint.unknown', { where: whereWords(t, fallback) })
  return atPlace(t, fallback, live, { hint })
}

export function openView(t: Translate, facts: OpenFacts): OpenView {
  const { executor, opening, plan } = facts
  const state = plan?.state ?? executor?.state ?? 'ended'
  if (state === 'gone') {
    const refusal = plan ? planRefusal(plan) : { reason: 'gone' as const }
    return { ...stands(t('open.state.gone'), refusalWords(t, refusal)) }
  }
  if (state === 'headless')
    return stands(
      `${t('open.place.headless')} · ${t('open.state.live')}`,
      refusalWords(t, { reason: 'live-headless' }),
    )
  const live = state === 'live'
  // The plan answers for the rule; the owner's own command takes no plan at all.
  return plan && opening?.always !== 'custom' ? fromPlan(t, plan, live) : fromRecord(t, facts, live)
}

/** What a button is called and what its tooltip leads with. */
export function openName(
  t: Translate,
  view: OpenView,
  who: { action?: string; name?: string },
): string {
  const { action, name } = who
  if (view.running) return t('open.name.running', { name: name ?? action ?? '', where: view.where })
  let words = action ?? t('open.name.plain', { name: name ?? '' })
  if (view.where)
    words = action ? `${action} ${view.where}` : t('open.name.at', { name, where: view.where })
  return view.setting ? `${words} — ${t('open.mark.setting')}` : words
}
