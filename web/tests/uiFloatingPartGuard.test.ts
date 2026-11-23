/**
 * What the floating-part rule refuses, and what it leaves alone because its scope does land.
 *
 * Every case here is paired with a refusal in the same fixture, so a rule that went quiet fails
 * each test, and a rule that refused too much fails the count.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'vitest'

import { scanUiTree } from '../scripts/check-ui-system.mjs'
import { scanFloatingPartScopes } from '../scripts/ui-system/floating-parts.mjs'

const MENU_IMPORT =
  "import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot } from 'reka-ui'"

/** A component in the shape of a menu: a script, a template and its style blocks, in that order. */
const component = (
  script: string,
  template: string,
  styles: string,
  file = 'future/Sheet.vue',
) => ({
  file,
  source: `<script setup lang="ts">\n${script}\n</script>\n\n<template>\n${template}\n</template>\n\n${styles}\n`,
})

/** A menu whose surface is the class on the portalled part, styled as `css` says. */
const menu = (css: string, popup = 'sheet-popup') =>
  component(
    MENU_IMPORT,
    [
      '  <DropdownMenuRoot>',
      '    <DropdownMenuPortal>',
      `      <DropdownMenuContent class="${popup}">`,
      '        <div class="sheet-list" />',
      '      </DropdownMenuContent>',
      '    </DropdownMenuPortal>',
      '  </DropdownMenuRoot>',
    ].join('\n'),
    css,
  )

test('a scoped surface rule on the class a floating part carries is refused, at the rule and the tag', () => {
  const css = [
    '<style scoped>',
    '.sheet-popup {',
    '  background: var(--color-surface);',
    '}',
    '',
    '.sheet-list {',
    '  display: contents;',
    '}',
    '</style>',
  ].join('\n')
  // The script takes lines 1-3, a blank line, the template opens on 5 and the part is on 8; the
  // template closes on 13, a blank line, and the style block opens on 15.
  assert.deepEqual(scanFloatingPartScopes([menu(css)]), [
    'future/Sheet.vue:16: the scoped rule `.sheet-popup` styles .sheet-popup, which future/Sheet.vue:8 writes on <DropdownMenuContent>; ' +
      "Reka puts that class inside its own wrapper, without this component's scope, so the rule never matches — " +
      'style the class in an unscoped <style> block, or an element this template writes inside the part',
  ])
})

test('the selector is refused when the class is in the compound Vue stamps, not elsewhere', () => {
  for (const refused of [
    '.sheet-popup:hover { color: red; }',
    ".sheet-popup[data-side='top'] { margin-top: 4px; }",
    '.sheet-popup::before { content: ""; }',
    '.frame > .sheet-popup { color: red; }',
    '.a, .sheet-popup.wide { color: red; }',
    ".sheet-popup { & .x {} &[data-state='open'] { color: red; } }",
    '@media (forced-colors: active) { .sheet-popup { outline: 1px solid; } }',
  ]) {
    // An ancestor, a negation, an escape and a rule that declares nothing are not the subject.
    const kept = [
      '.sheet-popup .sheet-list { gap: 4px; }',
      '.sheet-list:not(.sheet-popup) { gap: 4px; }',
      ':global(.sheet-popup) { color: red; }',
      '.sheet-popup {}',
    ].join('\n')
    const found = scanFloatingPartScopes([menu(`<style scoped>\n${kept}\n${refused}\n</style>`)])
    assert.equal(found.length, 1, refused)
    assert.match(found[0] ?? '', /styles \.sheet-popup, which/u, refused)
  }
})

test('what keeps its scope is left alone: an unscoped block, a teleport, an item part, inline content, a local part', () => {
  const control = '<DropdownMenuContent class="control-popup" />'
  const controlCss = '.control-popup { color: red; }'
  const cases: { script: string; template: string; unscoped?: boolean }[] = [
    // The surface where VMenu keeps it now.
    { script: MENU_IMPORT, template: '<DropdownMenuContent class="kept" />', unscoped: true },
    // An element this template writes is stamped wherever a Teleport mounts it.
    { script: MENU_IMPORT, template: '<Teleport to="body"><div class="kept" /></Teleport>' },
    // An item part draws its own element, which takes the class and the scope together.
    {
      script: "import { DropdownMenuContent, DropdownMenuItem } from 'reka-ui'",
      template: '<DropdownMenuContent><DropdownMenuItem class="kept" /></DropdownMenuContent>',
    },
    // Inline, a combobox's content is its own element.
    {
      script: `${MENU_IMPORT}\nimport { ComboboxContent } from 'reka-ui'`,
      template: '<ComboboxContent class="kept" />',
    },
    // A local component of the same name is not Reka's.
    {
      script: `${MENU_IMPORT}\nimport HoverCardContent from '@/shared/ui/HoverCardContent.vue'`,
      template: '<HoverCardContent class="kept" />',
    },
  ]
  for (const { script, template, unscoped } of cases) {
    const kept = '.kept { color: blue; }'
    const styles = unscoped
      ? `<style>${kept}</style>\n<style scoped>${controlCss}</style>`
      : `<style scoped>\n${kept}\n${controlCss}\n</style>`
    const found = scanFloatingPartScopes([component(script, `${control}\n${template}`, styles)])
    assert.equal(found.length, 1, template)
    assert.match(found[0] ?? '', /styles \.control-popup, which/u, template)
  }
})

test('every floating part is read however the template names it', () => {
  const cases = [
    {
      script: "import { ComboboxContent } from 'reka-ui'",
      template: '<ComboboxContent position="popper" class="sheet-popup" />',
      part: 'ComboboxContent',
    },
    {
      script: "import { HoverCardContent as Card } from 'reka-ui'",
      template: '<Card class="sheet-popup" />',
      part: 'HoverCardContent',
    },
    {
      script: "import { SelectContent } from 'reka-ui'",
      template: '<select-content class="other sheet-popup" />',
      part: 'SelectContent',
    },
  ]
  for (const { script, template, part } of cases) {
    const found = scanFloatingPartScopes([
      component(script, template, '<style scoped>.sheet-popup { color: red; }</style>'),
    ])
    assert.equal(found.length, 1, template)
    assert.match(found[0] ?? '', new RegExp(`writes on <${part}>`, 'u'), template)
  }
})

test('a sheet the component scopes with src is read at its own lines', () => {
  const host = menu('<style scoped src="./sheet.css"></style>')
  const sheet = {
    file: 'future/sheet.css',
    source: '.sheet-list { gap: 4px; }\n\n.sheet-popup { color: red; }\n',
  }
  const found = scanFloatingPartScopes([host, sheet])
  assert.equal(found.length, 1)
  assert.match(found[0] ?? '', /^future\/sheet\.css:3: the scoped rule `\.sheet-popup`/u)
  // Read as a global stylesheet, the same file is not this rule's.
  const global = menu('<style src="./sheet.css"></style>')
  assert.equal(scanFloatingPartScopes([global, sheet]).length, 0)
})

test('the gate runs the rule', () => {
  const root = mkdtempSync(join(tmpdir(), 'valkama-ui-guard-'))
  try {
    mkdirSync(join(root, 'future'), { recursive: true })
    const fixture = menu('<style scoped>.sheet-popup { color: var(--color-text); }</style>')
    writeFileSync(join(root, fixture.file), fixture.source)
    const found = scanUiTree(root).filter((violation) => violation.includes('Reka puts that class'))
    assert.equal(found.length, 1)
    assert.ok(found[0]?.startsWith('future/Sheet.vue:'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
