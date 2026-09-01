/**
 * The two Feature-Sliced rules: a file imports only from a layer below its own,
 * and a slice never imports a sibling slice. Plus the runtime cycle check, which
 * is what is left once downward-only imports make a cross-layer cycle impossible.
 */

const LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared']

/** Layers whose folders are slices; `shared` is segments and has none. */
const SLICED = new Set(['pages', 'widgets', 'features', 'entities'])

/**
 * Imports run one way, and a slice never reaches sideways.
 *
 * Two rules, and each answers a way the previous flat layout decayed. Downward
 * only: a shared primitive that imports a page has quietly become part of that
 * page. No siblings: two widgets that import each other are one widget that has
 * been filed under two names, and neither can be moved or deleted alone.
 */
export function scanImportDirection(sources) {
  const violations = []
  for (const { file, source } of sources) {
    const [layer, slice] = file.split('/')
    const rank = LAYERS.indexOf(layer)
    if (rank === -1) continue
    for (const match of source.matchAll(/from\s+['"]@\/([^'"]+)['"]/g)) {
      const [targetLayer, targetSlice] = match[1].split('/')
      const targetRank = LAYERS.indexOf(targetLayer)
      if (targetRank === -1) continue
      if (targetRank < rank) {
        violations.push(`${file}: ${layer}/ must not import ${targetLayer}/, which is above it`)
      } else if (targetRank === rank && SLICED.has(layer) && targetSlice !== slice) {
        violations.push(
          `${file}: ${layer} slice ${slice} must not import sibling slice ${targetSlice}`,
        )
      }
    }
  }
  return violations
}

/**
 * Resolve one `@/` specifier to a collected file.
 *
 * Most imports here name the extension, but the alias also accepts the
 * extensionless and directory-index forms, and a cycle that hides behind one of
 * those is still a cycle.
 */
function resolveAliasTarget(specifier, known) {
  for (const candidate of [
    specifier,
    `${specifier}.ts`,
    `${specifier}.vue`,
    `${specifier}/index.ts`,
  ]) {
    if (known.has(candidate)) return candidate
  }
  return null
}

/**
 * The `@/` targets one file still imports once the compiler is done with it.
 *
 * `import type` and `export type` are erased, so two contract modules naming
 * each other's types are not a cycle in any sense that can break initialization
 * order. A mixed statement still counts: one value specifier keeps the edge.
 */
function runtimeAliasTargets(source) {
  const targets = []
  for (const match of source.matchAll(/from\s+['"]@\/([^'"]+)['"]/g)) {
    const before = source.slice(0, match.index)
    const keyword = Math.max(before.lastIndexOf('import'), before.lastIndexOf('export'))
    if (keyword === -1) continue
    if (/^(?:import|export)\s+type\b/.test(before.slice(keyword))) continue
    targets.push(match[1])
  }
  return targets
}

/**
 * The same cycle reached from two entry points, named once.
 *
 * The separator is NUL because a path cannot contain one, so no two different
 * cycles can produce the same key. It is written as an escape rather than as
 * the character itself: this file held a literal NUL until now, which made git
 * classify the whole guard as binary and skip its line-ending normalization.
 */
function cycleKey(cycle) {
  let start = 0
  for (let index = 1; index < cycle.length; index += 1) {
    if (cycle[index] < cycle[start]) start = index
  }
  return [...cycle.slice(start), ...cycle.slice(0, start)].join('\0')
}

/**
 * Import cycles, which the direction rules cannot see.
 *
 * Downward-only imports make a cycle across layers impossible, so what remains
 * is a cycle inside one layer: two `shared` segments that import each other, or
 * two files of a single slice. Those compile, pass every other check here, and
 * are exactly what makes a file impossible to read, move or delete on its own.
 */
export function scanImportCycles(sources) {
  const known = new Set(sources.map((entry) => entry.file))
  const imports = new Map(
    sources.map(({ file, source }) => [
      file,
      runtimeAliasTargets(source)
        .map((specifier) => resolveAliasTarget(specifier, known))
        .filter((target) => target !== null && target !== file),
    ]),
  )
  const violations = []
  const reported = new Set()
  const state = new Map()
  const path = []

  const visit = (file) => {
    state.set(file, 'visiting')
    path.push(file)
    for (const target of imports.get(file) ?? []) {
      if (state.get(target) === 'visiting') {
        const cycle = path.slice(path.indexOf(target))
        const key = cycleKey(cycle)
        if (!reported.has(key)) {
          reported.add(key)
          violations.push(`${cycle[0]}: import cycle ${[...cycle, cycle[0]].join(' -> ')}`)
        }
      } else if (!state.has(target)) {
        visit(target)
      }
    }
    path.pop()
    state.set(file, 'done')
  }

  for (const { file } of sources) if (!state.has(file)) visit(file)
  return violations
}
