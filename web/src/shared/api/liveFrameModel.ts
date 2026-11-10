/**
 * The live-work frame: where work is going on now, across every space of the
 * primary store, as the connection contract's "The live-work frame" describes it.
 *
 * The side panel draws it and the picker of mentions offers its rows first. It
 * arrives as `event: live` in a stream the page already has, and as the answer to
 * a pin. The server sends it in the order it is drawn, so a client does not sort
 * it; `parent` always names a row of the same space. A `quiet` row, silent for
 * over a day, says since when, and every row says when its item last changed, which
 * only a write to the item moves: the side panel orders the work going on now by it.
 * Beside its rows a space lists the sessions that work or wait on none of them, and
 * `elsewhere` lists those whose folder lies under no space.
 */

import {
  boundedList,
  boundedText,
  parseContract,
  positiveInt,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import { executorSchema } from '@/shared/api/executorModel.ts'
import { TIMELESS_LIVE_STATES } from '@/shared/api/liveWorkModel.ts'
import {
  blankable,
  SPACE_KEY,
  TITLE,
  WORK_ITEM_KINDS,
  WORK_ITEM_REFERENCE,
} from '@/shared/api/planningModel.ts'
import { enumField, invalid, ISO, PROJECT_ID } from '@/shared/api/platformApiGuards.ts'

const rowShape = {
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  title: boundedText(TITLE, 200),
  kind: enumField(WORK_ITEM_KINDS),
  parent: boundedText(WORK_ITEM_REFERENCE, 20).nullable(),
  /** The live subagents placed on this item; the session's own run is the state. */
  agents: positiveInt(true),
  /** A waiting row's session silent for over four hours; false on any other row. */
  long: z.boolean(),
  /** A waiting row's session stopped mid-turn to ask a person; false on any other row. */
  asks: z.boolean(),
  /** When the session behind a working or waiting row began what it does now; else null. */
  since: boundedText(ISO, 96).nullable(),
  /** The session the row's state comes from; null with no live work or only an attempt. */
  executor: executorSchema.nullable(),
  pinned: z.boolean(),
  /** The item's workflow state, as a link names the state of its other end. */
  state_name: boundedText(TITLE, 200),
  is_terminal: z.boolean(),
  /** When the item last changed; only a write to it moves this. */
  updated_at: boundedText(ISO, 96),
}

const liveRowSchema = z.union([
  strictObject({
    ...rowShape,
    state: enumField(TIMELESS_LIVE_STATES).nullable(),
    quiet_since: z.null(),
  }),
  strictObject({ ...rowShape, state: z.literal('quiet'), quiet_since: boundedText(ISO, 96) }),
])

/** A session that works or waits on no row of the frame. */
const liveSessionSchema = strictObject({
  /** The session's id, which a click opens. */
  session: boundedText(TITLE, 200),
  /** The name its client shows for it; null when there is none to read. */
  title: boundedText(TITLE, 200).nullable(),
  /** The last part of the folder it was opened in, or empty. */
  folder: blankable(260),
  state: enumField(['working', 'waiting'] as const),
  long: z.boolean(),
  asks: z.boolean(),
  agents: positiveInt(true),
  since: boundedText(ISO, 96),
  executor: executorSchema,
})

const liveSpaceSchema = strictObject({
  key: boundedText(SPACE_KEY, 8),
  name: boundedText(TITLE, 200),
  project_id: boundedText(PROJECT_ID, 160).nullable(),
  rows: boundedList(liveRowSchema, 2000),
  /** The sessions under this space on no row, freshest first. */
  sessions: boundedList(liveSessionSchema, 500),
})

const liveFrameSchema = strictObject({
  spaces: boundedList(liveSpaceSchema, 200),
  /** The same list for sessions whose folder lies under no space. */
  elsewhere: boundedList(liveSessionSchema, 500),
})

export type LiveFrame = z.infer<typeof liveFrameSchema>

/** A session of a space's `sessions` or of `elsewhere`. */
export type LiveSession = z.infer<typeof liveSessionSchema>

export function validateLiveFrame(value: unknown): LiveFrame {
  return parseContract(liveFrameSchema, value, 'planning.live', invalid)
}
