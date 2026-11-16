/**
 * A planning space as the read model names it.
 *
 * A space holds no project of its own: the registry binds projects to it, one of
 * them its default, and the server adds them to the record it reads from the
 * store. A registry the server could not read knows no projects, which is not
 * the same as none, so both fields are then null.
 */

import { boundedList, boundedText, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { enumField, ISO, PROJECT_ID, UUID } from '@/shared/api/platformApiGuards.ts'

export const SPACE_KEY = /^[A-Z][A-Z0-9]{1,7}$/u
export const TITLE = /^[^\u{0}]{1,200}$/u

/** Where an agent launched from one of the space's cards works. */
export const LAUNCH_PLACES = ['space', 'item_project'] as const

const spaceProjectSchema = strictObject({
  project_id: boundedText(PROJECT_ID, 160),
  display_name: boundedText(TITLE, 200),
  /** The project's registered root, an absolute path on the server's machine. */
  root: boundedText(/^[^\u{0}]{1,32767}$/u, 32_767),
  default: z.boolean(),
})

const spaceIdentityShape = {
  planning_space_id: boundedText(UUID, 36),
  name: boundedText(TITLE, 200),
  key: boundedText(SPACE_KEY, 8),
  provider_kind: enumField(['local'] as const),
  launch_place: enumField(LAUNCH_PLACES),
  /** The default first, then by id; null when the registry was not read. */
  projects: boundedList(spaceProjectSchema, 500).nullable(),
  /** Null when no project is bound or the registry was not read. */
  default_project: boundedText(PROJECT_ID, 160).nullable(),
}
export const spaceIdentitySchema = strictObject(spaceIdentityShape)
export const spaceBriefSchema = strictObject({
  ...spaceIdentityShape,
  work_items: positiveInt(true),
  open: positiveInt(true),
  active: positiveInt(true),
  completed: positiveInt(true),
  updated_at: boundedText(ISO, 96),
})
