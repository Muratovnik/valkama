/**
 * The live-work frame: where work is going on now, across every space of the
 * primary store, as the connection contract's "The live-work frame" describes it.
 *
 * The side panel draws it and the picker of mentions offers its rows first. It
 * arrives as `event: live` in a stream the page already has, and as the answer to
 * a pin. The server sends it in the order it is drawn, so a client does not sort
 * it; `parent` always names a row of the same space. A `quiet` row, silent for
 * over a day, says since when; no other row carries a time.
 */

import {
  boundedList,
  boundedText,
  parseContract,
  positiveInt,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import { TIMELESS_LIVE_STATES } from '@/shared/api/liveWorkModel.ts'
import {
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
  pinned: z.boolean(),
  /** The item's workflow state, as a link names the state of its other end. */
  state_name: boundedText(TITLE, 200),
  is_terminal: z.boolean(),
}

const liveRowSchema = z.union([
  strictObject({
    ...rowShape,
    state: enumField(TIMELESS_LIVE_STATES).nullable(),
    quiet_since: z.null(),
  }),
  strictObject({ ...rowShape, state: z.literal('quiet'), quiet_since: boundedText(ISO, 96) }),
])

const liveSpaceSchema = strictObject({
  key: boundedText(SPACE_KEY, 8),
  name: boundedText(TITLE, 200),
  project_id: boundedText(PROJECT_ID, 160).nullable(),
  /** Agents at work in this space on no row: a caption, never a binding. */
  unplaced: positiveInt(true),
  rows: boundedList(liveRowSchema, 2000),
})

const liveFrameSchema = strictObject({
  spaces: boundedList(liveSpaceSchema, 200),
  /** The same count for sessions whose folder lies under no space. */
  elsewhere: positiveInt(true),
})

export type LiveFrame = z.infer<typeof liveFrameSchema>

export function validateLiveFrame(value: unknown): LiveFrame {
  return parseContract(liveFrameSchema, value, 'planning.live', invalid)
}
