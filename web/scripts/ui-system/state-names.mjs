/**
 * A workflow state's name reaches the screen through one function, `useStateName`
 * (`shared/lib/stateNames.ts`), never as the bare field.
 *
 * The name is the space's data: «Dev», «Review», «Done» in English whatever the interface's
 * language, and twenty places printed it as it came. The function shows a standard state that
 * kept its name in the reader's language and every other state as written, as the owner chose
 * in Settings, so a place that prints the field itself reads in another language than the
 * board beside it and does not follow the setting.
 *
 * So no script or template reads `….state.name`, `….state_name` or the name of a state it
 * found in `….states`. A comment may name them. A real exception — the function itself, a
 * comparison that names nothing — is registered below by file and the expression as written,
 * with its reason; a registered one that is gone is refused too, so the register says what the
 * tree holds.
 */

import { uncommented } from './comments.mjs'

/** `file expression` → why that place may read the name itself. */
export const STATE_NAME_READS = new Map([
  ['shared/lib/stateNames.ts state.name', 'the one function: it decides what the name reads as'],
  [
    'shared/api/planningChainGroups.ts member.state.name',
    'compares two members for one state; the name it shows comes from the function',
  ],
  [
    'shared/api/planningChainGroups.ts first.state.name',
    'compares two members for one state; the name it shows comes from the function',
  ],
  [
    'widgets/app-nav/components/NavWorkRow.vue props.row.state_name',
    'the row carries the name alone, and hands it to the function',
  ],
  [
    'widgets/work-item-inspector/components/InspectorRelations.vue link.state_name',
    "hands the other end's state to the function, and asks whether the server named one",
  ],
])

const READ = /[\w$.?]*\bstate\??\.name\b|[\w$.?]*\.state_name\b|\.states\.find\(.*?\)\??\.name\b/g

const lineOf = (source, index) => source.slice(0, index).split('\n').length

export function scanStateNames(sources, register = STATE_NAME_READS) {
  const violations = []
  const seen = new Set()
  for (const { file, source } of sources) {
    if (!/\.(?:ts|vue)$/.test(file)) continue
    const code = uncommented(file, source)
    for (const match of code.matchAll(READ)) {
      const what = `${file} ${match[0]}`
      if (register.has(what)) seen.add(what)
      else
        violations.push(
          `${file}:${lineOf(code, match.index)}: ${match[0]} prints a workflow state's name as the space wrote it; name it through useStateName (shared/lib/useStateName.ts), which translates a standard state and follows the owner's setting`,
        )
    }
  }
  for (const what of register.keys())
    if (!seen.has(what)) violations.push(`${what}: registered as a state name read, and gone`)
  return violations
}
