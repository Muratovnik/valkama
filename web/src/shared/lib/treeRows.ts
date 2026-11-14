/**
 * A set of things with parents, laid out as the rows of a tree: how deep each
 * stands, whether it is open, where it stands among the rows beside it, and
 * which rows stand only as the path to what a filter let through.
 *
 * The model knows nothing of what its things are. A consumer says how to read
 * one (`TreeSource`) — its id, its parent, whether it holds others and whether
 * it is still open — and draws the rows itself, with columns of its own. A row
 * for a group, such as another space's cards, is a thing the consumer adds to
 * the set and names as their parent; the model tells it from no other row.
 *
 * Under a filter the tree shows what matched and every ancestor of it. An
 * ancestor that does not match itself is a path row (`context`), and a
 * container with nothing that matched under it is not drawn. What is folded is
 * the consumer's to say (`folded`), from the reader's choice or the rule
 * (`foldedByRule`); the model reports the facts the rule reads.
 *
 * The roles and the attributes a tree's table and rows carry come from here
 * and nowhere else (`treeGridAttrs`, `treeRowAttrs`): `check:ui-system` refuses
 * them in any other file, so every tree says the same thing to a reader.
 *
 * Each thing is visited once, so a cycle of parents, which the server refuses
 * anyway, cannot make the walk endless: the first thing of a cycle in the
 * set's order stands at the top, with the rest of the cycle under it.
 */

/** How the model reads one thing of the set. */
export interface TreeSource<Item> {
  id: (item: Item) => string
  /** Whether it holds others: only a container folds. */
  isContainer: (item: Item) => boolean
  /** Not finished: what the fold rule counts. */
  isOpen: (item: Item) => boolean
  /** A parent outside the set makes a row of the top level. */
  parentId: (item: Item) => string | null
}

export interface TreeInput<Item> {
  /** The whole scope, before any filter. */
  items: readonly Item[]
  /** The ids the filter let through; null where nothing is filtered. */
  matches: ReadonlySet<string> | null
  /** Whether a container that has something to show is folded: the reader's choice or the rule. */
  folded: (id: string, facts: FoldFacts) => boolean
  /** The order of the rows that share a parent. */
  order: (left: Item, right: Item) => number
}

/** What the fold rule reads about a container. */
export interface FoldFacts {
  /** The rows the tree can draw under it under this filter, at any depth. */
  drawable: number
  filtered: boolean
  /** Open things under it, at any depth. */
  open: number
}

export interface TreeRow<Item> {
  /** A path row: shown only for what matched under it. */
  context: boolean
  /** 0 for a row of the top level. */
  depth: number
  /** Null where there is nothing under it to show. */
  expanded: boolean | null
  id: string
  item: Item
  /** What matched under it, at any depth; 0 where nothing is filtered. */
  matchesInside: number
  parentId: string | null
  /** Its place among them, from 1. */
  posInSet: number
  /** The rows shown beside it under its parent, itself included. */
  setSize: number
}

export interface TreeLayout<Item> {
  /** The rows the tree could show with nothing folded. */
  population: number
  rows: TreeRow<Item>[]
  /** A thing's parent in the tree; null at the top level and for an id it does not hold. */
  parentOf: (id: string) => string | null
}

/** A container holding more open things than this starts folded, as a graph frame does. */
export const FOLD_ABOVE = 20

/**
 * How a container stands where nobody chose: folded when it holds more than
 * `FOLD_ABOVE` open things or none, so a space of mostly finished goals opens
 * short. Under a filter a container is open, so what matched shows.
 */
export function foldedByRule(facts: FoldFacts): boolean {
  return !facts.filtered && (facts.open > FOLD_ABOVE || facts.open === 0)
}

interface Node<Item> {
  drawable: number
  id: string
  item: Item
  kids: Node<Item>[]
  matchesInside: number
  open: number
  shown: boolean
}

/** Each thing as a node, and each thing's parent in the set: null at the top level. */
function nodesOf<Item>(source: TreeSource<Item>, items: readonly Item[]) {
  const nodes = new Map<string, Node<Item>>()
  for (const item of items) {
    const id = source.id(item)
    if (!nodes.has(id))
      nodes.set(id, { drawable: 0, id, item, kids: [], matchesInside: 0, open: 0, shown: true })
  }
  const parents = new Map<string, string | null>()
  const children = new Map<string, Node<Item>[]>()
  for (const node of nodes.values()) {
    const named = source.parentId(node.item)
    const parent = named !== null && named !== node.id && nodes.has(named) ? named : null
    parents.set(node.id, parent)
    if (parent === null) continue
    const kids = children.get(parent)
    if (kids) kids.push(node)
    else children.set(parent, [node])
  }
  return { children, nodes, parents }
}

/**
 * The nodes as a forest in order, each counted for the fold rule and the
 * filter. Each node is visited once, from the top; what a cycle leaves
 * unreached heads it.
 */
function forestOf<Item>(source: TreeSource<Item>, input: TreeInput<Item>) {
  const { matches } = input
  const { children, nodes, parents } = nodesOf(source, input.items)
  const byOrder = (left: Node<Item>, right: Node<Item>) => input.order(left.item, right.item)
  const visited = new Set<string>()
  function attach(node: Node<Item>) {
    visited.add(node.id)
    for (const kid of children.get(node.id) ?? []) {
      if (visited.has(kid.id)) continue
      node.kids.push(kid)
      attach(kid)
    }
    node.kids.sort(byOrder)
    for (const kid of node.kids) {
      node.open += kid.open + (source.isOpen(kid.item) ? 1 : 0)
      node.matchesInside += kid.matchesInside + (matches?.has(kid.id) ? 1 : 0)
      if (kid.shown) node.drawable += 1 + kid.drawable
    }
    node.shown = matches === null || matches.has(node.id) || node.matchesInside > 0
  }
  const roots: Node<Item>[] = []
  const heads = [...nodes.values()].filter((node) => parents.get(node.id) === null)
  for (const node of [...heads, ...nodes.values()]) {
    if (visited.has(node.id)) continue
    parents.set(node.id, null)
    roots.push(node)
    attach(node)
  }
  return { parents, roots: roots.sort(byOrder) }
}

export function treeRows<Item>(source: TreeSource<Item>, input: TreeInput<Item>): TreeLayout<Item> {
  const { matches } = input
  const { parents, roots } = forestOf(source, input)
  const filtered = matches !== null
  const rows: TreeRow<Item>[] = []
  function lay(siblings: readonly Node<Item>[], parentId: string | null, depth: number) {
    const shown = siblings.filter((node) => node.shown)
    for (const [at, node] of shown.entries()) {
      const foldable = node.drawable > 0 && source.isContainer(node.item)
      const facts = { drawable: node.drawable, filtered, open: node.open }
      const expanded = foldable ? !input.folded(node.id, facts) : null
      rows.push({
        context: matches !== null && !matches.has(node.id),
        depth,
        expanded,
        id: node.id,
        item: node.item,
        matchesInside: node.matchesInside,
        parentId,
        posInSet: at + 1,
        setSize: shown.length,
      })
      if (expanded !== false) lay(node.kids, node.id, depth + 1)
    }
  }
  lay(roots, null, 0)

  let population = 0
  for (const root of roots) if (root.shown) population += 1 + root.drawable

  return { parentOf: (id) => parents.get(id) ?? null, population, rows }
}

/**
 * The role and the row count of a tree's table. The count is said only where
 * the table draws a window of its rows: drawn whole, the browser counts them.
 * `rowCount` is every row of the table, its head's included.
 */
export function treeGridAttrs(table: { rowCount: number; windowed: boolean }): {
  'role': 'treegrid'
  'aria-rowcount'?: number
} {
  return table.windowed
    ? { 'role': 'treegrid', 'aria-rowcount': table.rowCount }
    : { role: 'treegrid' }
}

/**
 * What a tree's row says to a reader: its level, whether it is open where it
 * has something to open, and its place among the rows beside it, which a
 * browser cannot count where only a window of the rows is drawn. `rowIndex` is
 * its place in the table, given where the table draws a window.
 */
export function treeRowAttrs(
  row: TreeRow<unknown>,
  rowIndex?: number,
): {
  'aria-level': number
  'aria-posinset': number
  'aria-setsize': number
  'aria-expanded'?: boolean
  'aria-rowindex'?: number
} {
  return {
    'aria-level': row.depth + 1,
    ...(row.expanded === null ? {} : { 'aria-expanded': row.expanded }),
    'aria-setsize': row.setSize,
    'aria-posinset': row.posInSet,
    ...(rowIndex === undefined ? {} : { 'aria-rowindex': rowIndex }),
  }
}
