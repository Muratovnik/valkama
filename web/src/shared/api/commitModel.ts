/**
 * A commit attached to the item, as its full record lists them, the newest first.
 * `repository` is null for a commit whose repository is not known, and the time
 * is Git's committer time, with its offset.
 */

import { blankable, boundedText, strictObject } from '@/shared/api/contract.ts'
import { callField } from '@/shared/api/planningText.ts'
import { enumField, PROJECT_ID } from '@/shared/api/platformApiGuards.ts'

export const commitSchema = strictObject({
  repository: boundedText(PROJECT_ID, 160).nullable(),
  display_name: boundedText(/^[^\u{0}]{1,200}$/u, 200).nullable(),
  hash: boundedText(/^[0-9a-f]{7,64}$/u, 64),
  subject: blankable(10_000),
  committed_at: boundedText(/^\d{4}-\d{2}-\d{2}T[^\s]{1,80}$/u, 96).nullable(),
  session: callField(),
  agent: callField(),
  attached_by: enumField(['server', 'manual', 'migrated'] as const),
  label: blankable(200),
})
