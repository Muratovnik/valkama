/**
 * Rules whose report this repository keeps and whose fix it drops.
 *
 * `unicorn/no-for-loop` rewrites an index loop into a `for…of` over `.entries()`. ESLint reads no
 * types here, so the rule cannot tell a string a call returned from an array, and its fix writes
 * `.entries()` on a string, which has none: `eslint --fix` then leaves code that lint and the unit
 * tests pass and only `vue-tsc` refuses. The loop is still reported, and whoever rewrites it sees
 * what it runs over.
 */

/** @import { ESLint, Rule } from 'eslint' */

/**
 * The rule with every fix it reports taken off.
 *
 * @param {Rule.RuleModule} rule
 * @returns {Rule.RuleModule}
 */
function withoutFix(rule) {
  return {
    ...rule,
    meta: { ...rule.meta, fixable: undefined },
    create: (context) =>
      rule.create(
        Object.create(context, {
          report: { value: (problem) => context.report({ ...problem, fix: null }) },
        }),
      ),
  }
}

/**
 * The plugin with the fix of each rule named taken off.
 *
 * @param {ESLint.Plugin} plugin
 * @param {readonly string[]} names
 * @returns {ESLint.Plugin}
 */
export function reportOnly(plugin, names) {
  const rules = { ...plugin.rules }
  for (const name of names) {
    const rule = rules[name]
    if (rule === undefined) throw new Error(`${plugin.meta?.name} has no rule ${name}`)
    rules[name] = withoutFix(rule)
  }
  return { ...plugin, rules }
}
