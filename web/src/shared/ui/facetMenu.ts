/**
 * What a facet filter's menu (`FacetFilter`) offers at each of its two steps, from what its host
 * says the filter is over (`FacetSource`).
 *
 * The menu opens on the facets, under the values no facet holds (`conditions`), and a facet's row
 * steps into that facet's values; a condition that holds values of its own, such as a period, is
 * a row among the conditions that steps into them the same way, as Linear and GitLab ask: every value of every facet at once was
 * a list a space's labels made thousands long. Typed text in the facets' step still finds a value
 * of any facet, the fast path for a reader who knows the word, and every value of a facet whose
 * name holds it; in a facet's step it narrows that facet's values. A host that can do something
 * with the text the filter cannot (`find`) has it offered as the menu's last row.
 *
 * The host says what each row is and whether it is in; this says only where the reader stands.
 * A facet's values are asked for only while the step on show needs them, so a host whose values
 * are read when asked (`FacetValues.note`) reads none it does not show.
 */
import type { OptionGroup, OptionRow } from '@/shared/ui/choiceControls.ts'

/** A way a facet's picked values can combine, offered in the head of its values' group. */
export type FacetChoice = NonNullable<OptionGroup<OptionRow>['choices']>[number]

/** One facet's values as they stand now. */
interface FacetValues<Row extends OptionRow> {
  /** Each value a press puts in the filter, or takes out if it was in. */
  rows: readonly Row[]
  /** Offered ahead of the values, and walked ahead of them; left out while text narrows them. */
  choices?: readonly FacetChoice[]
  /** Said under the values, where they are not all there: a wait, or a read that failed. */
  note?: string
}

/**
 * What a filter is over: the host's contract with `FacetFilter`. Each function is read only while
 * the menu is open, and a facet's `values` only while its step is on show or text searches every
 * facet, so a host that builds or reads its values when asked spends nothing on a closed menu.
 *
 * Keys are unique across the menu and stable while a value is offered; `back`, `everywhere` and
 * any key starting `open:` are the menu's own.
 */
export interface FacetSource<Row extends OptionRow> {
  /**
   * The values no facet holds, offered first and named as a group of their own, and the facets
   * stepped into from among them (`facets`), each after those values; none for none.
   */
  conditions?: () => {
    name: string
    rows: readonly Row[]
    facets?: readonly { id: string; name: string }[]
  } | null
  /** The facets, in the order a reader narrows by them; an id is no key of a row. */
  facets: () => readonly { id: string; name: string }[]
  values: (facet: string) => FacetValues<Row>
}

/** The words the menu says of its own rows. */
export interface FacetMenuWords {
  /** The facets' group, «Filter by». */
  facets: string
  /** The last row, for text this filter cannot find; absent where the host has nothing to do with it. */
  find?: { group: string; row: (text: string) => string }
  /** Said in place of the values where text found none; absent to say nothing. */
  noMatch?: string
  /** The way back from a facet's values, named for a screen reader: «Label: back to the facets». */
  back: (facet: string) => string
}

/** What taking a row does, by its key. */
type MenuEntry =
  /** The value goes into the filter, or out if it was in; a condition's facet is null. */
  | { do: 'pick'; facet: string | null; key: string }
  /** A way the facet's values combine. */
  | { do: 'choose'; facet: string; key: string }
  /** The menu steps into the facet's values. */
  | { do: 'open'; facet: string; key: string }
  /** The menu steps back to the facets. */
  | { do: 'back'; key: string }
  /** The text goes to what the host does with it (`FacetMenuWords.find`). */
  | { do: 'find'; key: string }

/** A group as the list draws it, with the note under its rows. */
type MenuGroup<Row extends OptionRow> = OptionGroup<Row | OptionRow>

/** The groups the list draws and what each of its rows does, in the order the arrows walk. */
export interface FacetMenu<Row extends OptionRow> {
  entries: MenuEntry[]
  groups: MenuGroup<Row>[]
}

interface ValueGroup<Row extends OptionRow> {
  /** The facet's id; null for the conditions. */
  facet: string | null
  id: string
  name: string
  rows: readonly Row[]
  choices?: readonly FacetChoice[]
  note?: string
}

const holds = (words: string, needle: string) => words.toLocaleLowerCase().includes(needle)

/**
 * A group with only the values whose word holds the needle, and without its choices, so ↓ and
 * Enter take the value found rather than a choice nobody typed.
 */
function narrowed<Row extends OptionRow>(group: ValueGroup<Row>, needle: string): ValueGroup<Row> {
  const rest: ValueGroup<Row> = {
    ...group,
    rows: group.rows.filter((row) => holds(row.text, needle)),
  }
  delete rest.choices
  return rest
}

/** The conditions as a group of values, where there are any. */
function conditionGroups<Row extends OptionRow>(source: FacetSource<Row>): ValueGroup<Row>[] {
  const conditions = source.conditions?.()
  return conditions?.rows.length
    ? [{ facet: null, id: 'conditions', name: conditions.name, rows: conditions.rows }]
    : []
}

/** The facets stepped into from among the conditions. */
const conditionFacets = <Row extends OptionRow>(source: FacetSource<Row>) =>
  source.conditions?.()?.facets ?? []

/** A facet's values as a group named for the facet. */
const facetGroup = <Row extends OptionRow>(
  source: FacetSource<Row>,
  facet: { id: string; name: string },
): ValueGroup<Row> => ({
  facet: facet.id,
  id: facet.id,
  name: facet.name,
  ...source.values(facet.id),
})

function drawn<Row extends OptionRow>(group: ValueGroup<Row>): MenuGroup<Row> {
  return {
    id: group.id,
    name: group.name,
    options: group.rows,
    ...(group.choices?.length ? { choices: group.choices } : {}),
    ...(group.note ? { note: group.note } : {}),
  }
}

/** The entries of a group of values, its choices first, in the order the arrows walk them. */
const valueEntries = (group: ValueGroup<OptionRow>): MenuEntry[] => [
  ...(group.choices ?? []).map(
    (choice) => ({ key: choice.key, do: 'choose', facet: group.facet ?? '' }) as const,
  ),
  ...group.rows.map((row) => ({ key: row.key, do: 'pick', facet: group.facet }) as const),
]

/** The groups drawn and their entries, as each step adds to them. */
const menuOf = <Row extends OptionRow>(groups: readonly ValueGroup<Row>[]): FacetMenu<Row> => ({
  groups: groups.map((group) => drawn(group)),
  entries: groups.flatMap((group) => valueEntries(group)),
})

/** A facet's values, headed by the way back, narrowed to what the text finds. */
function valuesStep<Row extends OptionRow>(
  whole: ValueGroup<Row>,
  needle: string,
  words: FacetMenuWords,
): FacetMenu<Row> {
  const group = needle ? narrowed(whole, needle) : whole
  const note = group.note ?? (needle && !group.rows.length ? words.noMatch : undefined)
  const { groups, entries } = menuOf([{ ...group, note }])
  return {
    groups: groups.map((one) => ({ ...one, back: { key: 'back', name: words.back(whole.name) } })),
    entries: [{ key: 'back', do: 'back' }, ...entries],
  }
}

/**
 * What text in the facets' step finds: every value whose word holds it, and every value of a group
 * whose name does. With nothing found and nothing to do with the text, the menu says why rather
 * than vanish: a facet's values still being read, or that nothing matched.
 */
function foundStep<Row extends OptionRow>(
  searched: readonly ValueGroup<Row>[],
  needle: string,
  words: FacetMenuWords,
): FacetMenu<Row> {
  const found = searched
    .map((group) => (holds(group.name, needle) ? group : narrowed(group, needle)))
    .filter((group) => group.rows.length)
  const note = searched.find((group) => group.note)?.note ?? words.noMatch
  if (found.length || words.find || !note) return menuOf(found)
  return {
    entries: [],
    groups: [{ id: 'found', name: words.facets, bare: true, options: [], note }],
  }
}

/** A row each that steps into a facet's values, and what taking it does. */
function stepRows(facets: readonly { id: string; name: string }[]) {
  return {
    rows: facets.map((one) => ({ key: `open:${one.id}`, text: one.name, next: true })),
    entries: facets.map((one) => ({ key: `open:${one.id}`, do: 'open', facet: one.id }) as const),
  }
}

/**
 * The facets, under the conditions: a row each that steps into its values, and the facets held
 * among the conditions after their values, in the conditions' group.
 */
function facetsStep<Row extends OptionRow>(
  source: FacetSource<Row>,
  facets: readonly { id: string; name: string }[],
  words: FacetMenuWords,
): FacetMenu<Row> {
  const conditions = source.conditions?.()
  const { groups, entries } = menuOf(conditionGroups(source))
  const held = stepRows(conditionFacets(source))
  const [first] = groups
  const group = first ?? { id: 'conditions', name: conditions?.name ?? '', options: [] }
  const conditionRows =
    conditions && held.rows.length
      ? [{ ...group, options: [...group.options, ...held.rows] }]
      : groups
  const own = stepRows(facets)
  return {
    groups: [...conditionRows, { id: 'facets', name: words.facets, options: own.rows }],
    entries: [...entries, ...held.entries, ...own.entries],
  }
}

/**
 * The menu at its step: the facets with the conditions over them, a facet's values headed by the
 * way back, or with text in the facets' step every value the text finds. Text always ends the
 * menu with what the host does with it, where it does something (`FacetMenuWords.find`).
 */
export function facetMenu<Row extends OptionRow>(input: {
  source: FacetSource<Row>
  /** The id of the facet whose values are on show; null for the facets' step. */
  step: string | null
  text: string
  words: FacetMenuWords
}): FacetMenu<Row> {
  const { source, words } = input
  const needle = input.text.trim()
  const lower = needle.toLocaleLowerCase()
  const facets = source.facets()
  const every = [...conditionFacets(source), ...facets]
  const facet = every.find((one) => one.id === input.step)
  let menu: FacetMenu<Row>
  if (facet) menu = valuesStep(facetGroup(source, facet), lower, words)
  else if (needle) {
    const searched = [...conditionGroups(source), ...every.map((one) => facetGroup(source, one))]
    menu = foundStep(searched, lower, words)
  } else menu = facetsStep(source, facets, words)
  if (!needle || !words.find) return menu
  const key = 'everywhere'
  return {
    groups: [
      ...menu.groups,
      {
        id: key,
        name: words.find.group,
        bare: true,
        options: [{ key, text: words.find.row(needle), icon: 'search' }],
      },
    ],
    entries: [...menu.entries, { key, do: 'find' }],
  }
}
