/**
 * Which items an agent is at work on now, as the server reads their sessions:
 * a turn is running, the session waits for a person, or it has been silent for
 * over a day. Only a silent one says since when; the others carry no time, so a
 * frame of the stream changes when a state does and not with every event. The
 * read model carries the map, keyed by item id, with only the items that have
 * live work.
 */

import { boundedText, strictObject, z } from '@/shared/api/contract.ts'
import { enumField, ISO, UUID } from '@/shared/api/platformApiGuards.ts'

const liveWorkSchema = z.union([
  strictObject({ state: enumField(['working', 'waiting'] as const) }),
  strictObject({ state: z.literal('quiet'), quiet_since: boundedText(ISO, 96) }),
])

export const liveWorkMapSchema = z.record(boundedText(UUID, 36), liveWorkSchema)
