/**
 * The projects a work item changes, as its record names them.
 *
 * A task holds the projects it was given; a goal or stage reads the projects of
 * the tasks under it, each by the strongest way it came to one of them.
 */

import { boundedList, boundedText, strictObject } from '@/shared/api/contract.ts'
import { enumField, PROJECT_ID } from '@/shared/api/platformApiGuards.ts'

/**
 * How a project came to the item, strongest first: `named` by whoever filed or
 * edited it, `commits` from the repositories of its commits, `migrated` from its
 * space's former project.
 */
const PROJECT_SOURCES = ['named', 'commits', 'migrated'] as const

const itemProjectSchema = strictObject({
  project_id: boundedText(PROJECT_ID, 160),
  /** Null when the registry does not name the project or could not be read. */
  display_name: boundedText(/^[^\u{0}]{1,200}$/u, 200).nullable(),
  source: enumField(PROJECT_SOURCES),
})

/** A container gathers its tasks' projects, so the list is bounded by the registry, not by 20. */
export const itemProjectsField = () => boundedList(itemProjectSchema, 500)
