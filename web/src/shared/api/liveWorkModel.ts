/**
 * Which items an agent is at work on now, as the server reads their sessions:
 * a turn is running and the session is seen working on the item (`working`), a
 * turn is running but on its other items (`held`), the session waits for a
 * person, or it has been silent for over a day. Only a silent one says since
 * when; the others carry no time, so a frame of the stream changes when a state
 * does and not with every event. The read model carries the map, keyed by item
 * id, with only the items that have live work; the live-work frame
 * (`liveFrameModel.ts`) carries the same states row by row.
 */

import { boundedText, strictObject, z } from '@/shared/api/contract.ts'
import { enumField, ISO, UUID } from '@/shared/api/platformApiGuards.ts'

/** Every live state but `quiet`, the one that says since when. */
export const TIMELESS_LIVE_STATES = ['working', 'held', 'waiting'] as const

const liveWorkSchema = z.union([
  strictObject({ state: enumField(TIMELESS_LIVE_STATES) }),
  strictObject({ state: z.literal('quiet'), quiet_since: boundedText(ISO, 96) }),
])

export const liveWorkMapSchema = z.record(boundedText(UUID, 36), liveWorkSchema)

/** One item's live work, as the read model's `live_work` carries it. */
export type LiveWork = z.infer<typeof liveWorkSchema>
