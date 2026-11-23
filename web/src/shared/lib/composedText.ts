/**
 * A text the service composed, said in the reader's language from its key and values: the
 * prompt of a question it asked (markdown, as the prompt is) and what the summary of agent
 * decisions says. The words are `composed.*` (`composedTextMessages.ts`); a title, a reason, a
 * summary and a step are the agent's own words and stand as written. A text with no key, which
 * an agent wrote or the service stored before keys, is shown as its stored text: this never
 * reads the English.
 */
import type { PromptMessage, WhatMessage } from '@/shared/api/composedTextModel.ts'

/** The catalogue's words: a message by its key, its values, and a count that picks its form. */
export type Say = (key: string, values?: Record<string, unknown>, count?: number) => string
/** A state's name, by its key, in the reader's words. */
export type StateWords = (key: string) => string

const Q = 'composed.question'
const D = 'composed.decision'
const REMOVED = `${Q}.steps_asked.removed`
const STEPS_ASK = `${Q}.steps_asked.ask`
/** The end of a sentence an agent wrote: a stop, a question or exclamation mark or an ellipsis. */
const SENTENCE_END = /[.!?…]["'»”’)\]]*$/u

/** An agent's words as a sentence of the text: closed by a full stop unless they end one. */
function sentence(text: string): string {
  const said = text.trim()
  return SENTENCE_END.test(said) ? said : `${said}.`
}

/**
 * What put-off work waits for, as said after «until»: the day, time or card as named, the count
 * of new comments, or both, whichever comes first.
 */
function putOffUntil(say: Say, until: string | null, comments: number | null): string {
  if (comments === null) return until ?? ''
  const counted = say('composed.until.comments', { n: comments }, comments)
  return until === null ? counted : say('composed.until.either', { until, comments: counted })
}

type Listed = { reason: string | null; reference: string }[]
type Confirmation = Extract<PromptMessage, { key: 'confirm_asked' }>['values']

function listed(say: Say, heading: string, entries: Listed): string[] {
  if (entries.length === 0) return []
  return [
    '',
    say(`${Q}.confirm.${heading}`),
    ...entries.map((entry) =>
      entry.reason ? `- ${entry.reference}: ${entry.reason}` : `- ${entry.reference}`,
    ),
  ]
}

/** The lines under a confirmation's first: what closed undone or left, its steps, what did not fit. */
function confirmationLines(say: Say, values: Confirmation): string[] {
  const lines = [
    ...listed(say, 'cancelled', values.cancelled),
    ...listed(say, 'moved_out', values.moved_out),
  ]
  if (values.steps.length > 0)
    lines.push('', say(`${Q}.confirm.steps`), ...values.steps.map((step) => `- ${step}`))
  else if (values.hidden === 0) lines.push('', say(`${Q}.confirm.noSteps`))
  if (values.hidden > 0) lines.push(say(`${Q}.confirm.hidden`, { n: values.hidden }, values.hidden))
  return lines
}

function agentConfirms(
  say: Say,
  head: 'agent' | 'agent_empty',
  values: Confirmation & { summary: string | null },
): string {
  const summary = values.summary ? say(`${Q}.confirm.summary`, { summary: values.summary }) : ''
  const ask = say(`${Q}.confirm.${head === 'agent' ? 'agentAsk' : 'emptyAsk'}`)
  const said = say(`${Q}.confirm.${head}`, { reference: values.reference })
  const first = `${sentence(said + summary)} ${ask}`
  return [first, ...confirmationLines(say, values)].join('\n')
}

/**
 * A cancel the owner decides on: what the agent does, the ask, then the agent's reason and what
 * the sessions at work said, which can run long and fold away without taking the ask with them.
 */
function cancelAsked(say: Say, values: Extract<PromptMessage, { key: 'cancel_asked' }>['values']) {
  const parts = [say(`${Q}.cancel_asked.${values.point}`), say(`${Q}.cancel_asked.ask`)]
  if (values.reason)
    parts.push(say(`${Q}.cancel_asked.reason`, { reason: sentence(values.reason) }))
  if (values.sessions_asked) parts.push(say(`${Q}.cancel_asked.sessions`))
  for (const objection of values.objections)
    parts.push(
      say(`${Q}.cancel_asked.objects`, {
        session: objection.session,
        reason: sentence(objection.reason),
      }),
    )
  if (values.unanswered.length > 0)
    parts.push(say(`${Q}.cancel_asked.unanswered`, { sessions: values.unanswered.join(', ') }))
  return parts.join(' ')
}

/**
 * A question's prompt, in markdown, from its key and values. Its own card's number and title stand
 * in the head over it, so the words call that card «this» and leave both values unsaid.
 */
function promptText(message: PromptMessage, say: Say, state: StateWords): string {
  switch (message.key) {
    case 'task_filed':
    case 'task_moved_in': {
      return say(`${Q}.${message.key}`, { goal: message.values.goal })
    }
    case 'goal_proposed':
    case 'goal_came_back': {
      return say(`${Q}.${message.key}`)
    }
    case 'task_moved_to': {
      const { goal, state: key } = message.values
      return say(`${Q}.task_moved_to`, { goal, state: state(key) })
    }
    case 'put_off_asked': {
      const { kind, reason, until, comments } = message.values
      return say(`${Q}.put_off_asked.${kind}`, {
        until: putOffUntil(say, until, comments),
        reason: sentence(reason),
      })
    }
    case 'put_off_came': {
      const { until, item, comments } = message.values
      if (comments !== null)
        return say(`${Q}.put_off_came.comments`, { comments: putOffUntil(say, null, comments) })
      return item === null
        ? say(`${Q}.put_off_came.until`, { until })
        : say(`${Q}.put_off_came.item`, { item })
    }
    case 'cancel_asked': {
      return cancelAsked(say, message.values)
    }
    case 'cancel_consent': {
      const { reason } = message.values
      const parts = [say(`${Q}.cancel_consent.head`)]
      if (reason) parts.push(say(`${Q}.cancel_consent.reason`, { reason: sentence(reason) }))
      parts.push(say(`${Q}.cancel_consent.ask`))
      return parts.join(' ')
    }
    case 'confirm_asked': {
      return [
        say(`${Q}.confirm.asked`, { reference: message.values.reference }),
        ...confirmationLines(say, message.values),
      ].join('\n')
    }
    case 'confirm_agent': {
      return agentConfirms(say, 'agent', message.values)
    }
    case 'confirm_agent_empty': {
      return agentConfirms(say, 'agent_empty', message.values)
    }
    case 'steps_asked': {
      const { kind, removed, rewritten, reason } = message.values
      const head = say(`${Q}.steps_asked.${kind}`)
      return [
        `${head} ${say(STEPS_ASK)}`,
        ...removed.map((text) => `- ${say(REMOVED, { text })}`),
        ...rewritten.map((entry) => `- «${entry.from}» → «${entry.to}»`),
        say(`${Q}.steps_asked.reason`, { reason: sentence(reason) }),
      ].join('\n')
    }
    case 'group_asked': {
      return say(`${Q}.group_asked`, message.values, message.values.count)
    }
    default: {
      // The strict schema reads no other key; `satisfies never` stops compiling the day
      // a key is added without its case.
      message satisfies never
      throw new TypeError('a composed prompt with a key the web does not read')
    }
  }
}

/** What the summary of agent decisions says was decided, from its key and values. */
function whatText(message: WhatMessage, say: Say): string {
  switch (message.key) {
    case 'accepted': {
      const { reference, under, label } = message.values
      if (label !== null) return say(`${D}.accepted_label`, { reference, label })
      return under === null
        ? say(`${D}.accepted`, { reference })
        : say(`${D}.accepted_under`, { reference, under })
    }
    case 'moved':
    case 'closed': {
      return say(`${D}.${message.key}`, message.values)
    }
    case 'put_off': {
      const { until, comments, ...values } = message.values
      return say(`${D}.put_off`, { ...values, until: putOffUntil(say, until, comments) })
    }
    case 'cancelled': {
      const { reference, question } = message.values
      return question === null
        ? say(`${D}.cancelled`, { reference })
        : say(`${D}.cancelled_following`, { reference, question })
    }
    case 'steps': {
      const { changes, reason } = message.values
      // The reason follows the last step removed or rewritten; a clarified one needs none.
      const last = changes.map((change) => change.change !== 'clarified').lastIndexOf(true)
      return changes
        .map((change, index) => {
          const said = say(`${D}.steps.${change.change}`, {
            before: change.before,
            after: change.after ?? '',
          })
          return index === last && reason ? `${said}: ${reason}` : said
        })
        .join('; ')
    }
    case 'chose': {
      return say(`${D}.chose`, {
        labels: message.values.labels.map((label) => `«${label}»`).join(', '),
      })
    }
    case 'group': {
      const { title, answer, count } = message.values
      return say(`${D}.group`, {
        title,
        answer: say(`${D}.answers.${answer}`),
        count: say(`${D}.items`, { n: count }, count),
      })
    }
    default: {
      message satisfies never
      throw new TypeError('a decision with a key the web does not read')
    }
  }
}

/** A question's prompt as the reader sees it: said from its key, or as stored without one. */
export function promptShown(
  request: { prompt: string; prompt_message?: PromptMessage | null },
  say: Say,
  state: StateWords,
): string {
  return request.prompt_message ? promptText(request.prompt_message, say, state) : request.prompt
}

/** What a decision says as the reader sees it: said from its key, or as stored without one. */
export function whatShown(
  decision: { what: string; what_message?: WhatMessage | null },
  say: Say,
): string {
  return decision.what_message ? whatText(decision.what_message, say) : decision.what
}
