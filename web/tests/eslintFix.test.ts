/**
 * `eslint --fix` leaves an index loop over a string as it was written. Without type information
 * `unicorn/no-for-loop` cannot tell a string a call returned from an array, and its fix rewrote
 * such a loop into `.entries()`, which a string lacks: lint and the unit tests passed the result,
 * and only `vue-tsc` refused it. The configuration keeps the rule's report and drops its fix.
 */

import type { ESLint } from 'eslint'
import { Linter } from 'eslint'
import unicorn from 'eslint-plugin-unicorn'
import ts from 'typescript-eslint'
import { expect, it } from 'vitest'

// Loaded as ESLint loads it, at run time: the config is not part of the type-checked program, and
// its plugins' published types do not all agree with typescript-eslint's.
const configFile = new URL('../eslint.config.ts', import.meta.url).href
const { default: config } = (await import(/* @vite-ignore */ configFile)) as {
  default: Linter.Config[]
}

/** A loop over a string that only a call's return type says is one. */
const loop = `const read = (): string => 'a b'

export function spaces(): number[] {
  const words = read()
  const found: number[] = []
  for (let at = 0; at < words.length; at++) {
    const letter = words[at]
    if (letter === ' ') found.push(at)
  }
  return found
}
`

/** The loop linted with `--fix` by `plugin`'s `no-for-loop` alone. */
function fixed(plugin: ESLint.Plugin) {
  const rules = { 'unicorn/no-for-loop': 'error' } as const
  const only = {
    files: ['**/*.ts'],
    languageOptions: { parser: ts.parser },
    plugins: { unicorn: plugin },
    rules,
  }
  return new Linter().verifyAndFix(loop, [only], { filename: 'indexLoop.ts' })
}

it('reports an index loop over a string and leaves it as written', () => {
  const configured = config.find((entry) => entry.plugins?.unicorn)?.plugins?.unicorn
  expect(configured).toBeDefined()
  const result = fixed(configured ?? unicorn)
  expect(result.output).toBe(loop)
  expect(result.messages.map((message) => message.ruleId)).toEqual(['unicorn/no-for-loop'])
})

it('is a loop the rule as published rewrites into .entries()', () => {
  expect(fixed(unicorn).output).toContain('of words.entries()')
})
