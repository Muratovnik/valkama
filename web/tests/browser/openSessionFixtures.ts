/**
 * A card with every kind of holder a click can or cannot reach, and the plan the server
 * would answer for each: the record's words are the same ones its real read carries.
 */
import type { Locator } from '@playwright/test'

import { identity } from './planningFixtures.ts'

/**
 * What a session button says beside its name, in order: whose session it is, by its client's
 * sign as a tile draws the executor, that the session runs and that a setting chose the place,
 * each a glyph named for a reader rather than words on the line. The place is in the button's
 * name and hint.
 */
export const markNames = (button: Locator) =>
  button
    .locator('.open-action-mark')
    .evaluateAll((marks) => marks.map((mark) => mark.getAttribute('aria-label') ?? ''))

const session = (end: number) => `6f1c2a8e-0000-4000-8000-${String(end).padStart(12, '0')}`

export const IN_VSCODE = session(1)
const IN_DESKTOP = session(2)
const IN_TERMINAL = session(3)
const LOST = session(4)
const NO_WINDOW = session(5)
const FIRST_OPEN = session(6)
const NO_FOLDER = session(7)
export const CRASHED = session(8)

/** A session the dialog's route names, which the browser backend knows and no item holds. */
export const UNLINKED_SESSION = '99999999-8888-4777-8666-555555555555'

export const FOLDER_LINK = 'vscode://file/C:/work/example-project'
export const SESSION_LINK = `vscode://anthropic.claude-code/open?session=${IN_VSCODE}`
export const DESKTOP_LINK = 'claude://code/continue?session=local_1'
export const RESUME_COMMAND = `claude --resume ${CRASHED}`

const vscode = { opened_in: 'ide', opened_host: 'vscode' }
const desktop = { opened_in: 'app', opened_host: 'claude-desktop' }
const terminal = { opened_in: 'terminal', opened_host: '' }
const codex = { opened_in: 'app', opened_host: 'codex-app' }
const nowhere = { opened_in: '', opened_host: '' }
const noWindow = { opened_in: 'headless', opened_host: '' }

const inWindow = [
  { kind: 'focus-folder', ide: 'vscode', folder: 'C:\\work\\example-project', link: FOLDER_LINK },
  { kind: 'open-link', scheme: 'vscode', link: SESSION_LINK },
]

function executorOf(id: string, place: object, state: string, family = 'claude') {
  return { session: id, agent: null, family, state, ...place }
}

const executors = {
  vscode: executorOf(IN_VSCODE, vscode, 'live'),
  desktop: executorOf(IN_DESKTOP, desktop, 'ended'),
  terminal: executorOf(IN_TERMINAL, terminal, 'live'),
  lost: executorOf(LOST, nowhere, 'gone'),
  noWindow: executorOf(NO_WINDOW, noWindow, 'headless'),
  firstOpen: executorOf(FIRST_OPEN, nowhere, 'ended', 'codex'),
  noFolder: executorOf(NO_FOLDER, vscode, 'ended'),
  crashed: executorOf(CRASHED, terminal, 'live'),
  nobody: { session: null, agent: null, family: '', state: 'none', ...nowhere },
}

function plan(
  id: string,
  state: string,
  place: object,
  { opens, steps }: { opens: object | null; steps: unknown[] },
) {
  return {
    target: { kind: 'session', session: id, agent: '' },
    surface: 'browser',
    client: 'claude',
    state,
    place: { source: 'recorded', first_open: false, ...place },
    opens: opens && { source: 'recorded', missed: '', ...opens },
    one_action: steps.length === 1,
    steps,
  }
}

const desktopLink = [{ kind: 'open-link', scheme: 'claude', link: DESKTOP_LINK }]
const fallingBack = { ...vscode, source: 'fallback' }

const PLANS: Record<string, object> = {
  [IN_VSCODE]: plan(IN_VSCODE, 'live', vscode, { opens: vscode, steps: inWindow }),
  [IN_DESKTOP]: plan(IN_DESKTOP, 'ended', desktop, { opens: desktop, steps: desktopLink }),
  [IN_TERMINAL]: plan(IN_TERMINAL, 'live', terminal, {
    opens: fallingBack,
    steps: [{ kind: 'explain', reason: 'live-in-terminal' }, ...inWindow],
  }),
  [LOST]: plan(LOST, 'gone', nowhere, {
    opens: null,
    steps: [{ kind: 'explain', reason: 'gone', archived: true }],
  }),
  [NO_WINDOW]: plan(NO_WINDOW, 'headless', noWindow, {
    opens: null,
    steps: [{ kind: 'explain', reason: 'live-headless' }],
  }),
  [FIRST_OPEN]: {
    ...plan(
      FIRST_OPEN,
      'ended',
      { ...codex, source: 'derived', first_open: true },
      {
        opens: { ...codex, source: 'derived' },
        steps: [{ kind: 'open-link', scheme: 'codex', link: `codex://threads/${FIRST_OPEN}` }],
      },
    ),
    client: 'codex',
  },
  [NO_FOLDER]: plan(NO_FOLDER, 'ended', vscode, {
    opens: null,
    steps: [{ kind: 'explain', reason: 'no-folder' }],
  }),
  [CRASHED]: plan(CRASHED, 'live', terminal, {
    opens: fallingBack,
    steps: [
      { kind: 'explain', reason: 'live-in-terminal', silent_since: '2026-08-10T09:15:00Z' },
      ...inWindow,
      { kind: 'copy', text: RESUME_COMMAND },
    ],
  }),
}

/** What `GET /api/open-plan` answers, with "always open in" as the page asked for it. */
export function openPlanFor(query: URLSearchParams): object {
  const id = query.get('session') ?? ''
  const always = query.get('always')
  // A session only an attempt or a link names, which the card's read says nothing of.
  const answered = PLANS[id] ?? plan(id, 'ended', desktop, { opens: desktop, steps: desktopLink })
  if (!always) return answered
  return {
    ...answered,
    opens: { opened_in: 'ide', opened_host: always, source: 'always', missed: '' },
    steps: inWindow,
  }
}

const LONG_NAME = 'a-coordinator-with-a-name-long-enough-to-run-out-of-a-phone'

const step = (index: number, text: string, overrides: object) => ({
  id: identity(310 + index),
  text,
  done: false,
  claimed_by: '',
  done_by: '',
  ...overrides,
})

/** A holder too long for a phone's line, in the head as on the steps. */
const LONG_HOLDER = `claude agent ${LONG_NAME} (session ${IN_VSCODE})`

/** The card's read with its holders filled in, for the backend's `card` hook. */
export const heldCard = (read: Record<string, unknown>) => ({
  ...read,
  claim_ref: LONG_HOLDER,
  claim_state: 'live',
  refs: [
    {
      kind: 'session',
      value: IN_DESKTOP,
      label: 'The session that wrote the first draft',
      author: 'the owner',
      at: '2026-08-13T08:00:00Z',
    },
  ],
  claim: {
    holder: LONG_HOLDER,
    state: 'live',
    session_id: IN_VSCODE,
    agent_id: null,
    source: 'hook',
    acquired_at: '2026-08-13T08:00:00Z',
    last_seen: '2026-08-13T08:29:00Z',
    expires_at: '2026-08-13T09:29:00Z',
    executor: executors.vscode,
  },
  checklist: [
    step(0, 'An agent in the editor', {
      claimed_by: LONG_HOLDER,
      executor: executors.vscode,
    }),
    step(1, 'The owner’s own', { claimed_by: 'the owner', executor: executors.nobody }),
    step(2, 'Running in a terminal', {
      claimed_by: `claude (session ${IN_TERMINAL})`,
      executor: executors.terminal,
    }),
    step(3, 'Done in Codex, as it was first opened', {
      done: true,
      done_by: `codex (session ${FIRST_OPEN})`,
      executor: executors.firstOpen,
    }),
    step(4, 'Done by a session its client has lost', {
      done: true,
      done_by: `claude (session ${LOST})`,
      executor: executors.lost,
    }),
    step(5, 'Held by an attempt with no window', {
      claimed_by: `claude (session ${NO_WINDOW})`,
      executor: executors.noWindow,
    }),
    step(6, 'Held by a session with no known folder', {
      claimed_by: `claude (session ${NO_FOLDER})`,
      executor: executors.noFolder,
    }),
    step(7, 'Held by a session silent for days', {
      claimed_by: `claude (session ${CRASHED})`,
      executor: executors.crashed,
    }),
  ],
})

/** The same, once it has closed: the claim has ended and the read says who held it. */
export const finishedCard = (read: Record<string, unknown>) => ({
  ...heldCard(read),
  claim_ref: '',
  claim_state: null,
  claim: null,
  closed_at: '2026-08-13T09:00:00Z',
  last_claim_ref: `claude (session ${IN_VSCODE})`,
  last_claim_executor: executors.desktop,
})

const agent = (index: number, executor: object) => ({
  agent_id: `agent${String(index).padStart(11, '0')}`,
  session_id: IN_VSCODE,
  agent_type: 'general-purpose',
  label: `Agent number ${index}`,
  started_at: '2026-08-13T08:00:00Z',
  last_activity_at: '2026-08-13T08:29:00Z',
  ended_at: null,
  steps: [],
  link: 'exact',
  coordinator_items: null,
  executor,
})

export const threeAgents = () => [
  agent(1, executors.vscode),
  agent(2, executors.desktop),
  agent(3, executors.lost),
]

/** One agent row for each state its parent session can be in, the order `executors` names them. */
export const agentsInEveryState = () =>
  Object.values(executors)
    .filter((executor) => executor.session !== null)
    .map((executor, index) => agent(index + 1, executor))

/** A holder as a client proves it, short enough to read whole beside its place. */
const SHORT_HOLDER = `claude (session ${IN_VSCODE})`

/** The held card with that holder in the head, as most cards have it. */
export const shortHolderCard = (read: Record<string, unknown>) => {
  const card = heldCard(read)
  return { ...card, claim_ref: SHORT_HOLDER, claim: { ...card.claim, holder: SHORT_HOLDER } }
}
