import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

import { i18n, messages, resolveLocale } from '@/shared/i18n/index.ts'

const SRC = fileURLToPath(new URL('../src', import.meta.url))

// A translation call whose key is written out: t('a.b'), te(...), $t(...).
// The compiler does not check these — useI18n() is called with no message
// schema, so t is typed loosely and a key that does not exist compiles clean.
//
// A key built at runtime, t(`activity.${action}`), is deliberately out of
// scope. Sixty-odd call sites do that, and no tool reads them: the intlify
// ESLint plugin would need an ignore list for exactly the same reason, on top
// of not reading a TypeScript catalog at all. Checking what can be checked is
// the whole gain; guessing at the rest would report keys that are in use.
const LITERAL_KEY = /(?<![\w$])(?:\$t|te|tm|t)\(\s*(['"])([A-Za-z0-9_.]+)\1/g

function catalogKeys(value: unknown, prefix = ''): string[] {
  return !value || typeof value !== 'object' || Array.isArray(value)
    ? [prefix]
    : Object.entries(value as Record<string, unknown>)
        .flatMap(([key, child]) => catalogKeys(child, prefix ? `${prefix}.${key}` : key))
        .sort()
}

function sourceFiles(): string[] {
  return fs
    .readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') || name.endsWith('.vue'))
}

function resolves(catalog: unknown, key: string): boolean {
  let node: unknown = catalog
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string'
}

test('English and Russian catalogs have exactly the same keys', () => {
  assert.deepEqual(catalogKeys(messages.en), catalogKeys(messages.ru))
})

test('every translation key written out in the source resolves in the catalog', () => {
  const missing: string[] = []
  const seen = new Set<string>()
  for (const relative of sourceFiles()) {
    const source = fs.readFileSync(path.join(SRC, relative), 'utf8')
    for (const match of source.matchAll(LITERAL_KEY)) {
      const key = match[2]
      seen.add(key)
      if (!resolves(messages.en, key)) missing.push(`${relative}: ${key}`)
    }
  }
  assert.deepEqual(missing, [])
  // Known retained call sites keep a broken scanner from reporting a clean catalog.
  for (const key of ['language.label', 'settings.interface', 'open.settings.title']) {
    assert.ok(seen.has(key), `the scan missed the retained call site for ${key}`)
  }
})

test('locale resolution prefers an explicit saved language, then Russian browser preference', () => {
  assert.equal(resolveLocale('en', ['ru-RU']), 'en')
  assert.equal(resolveLocale('ru', ['en-US']), 'ru')
  assert.equal(resolveLocale(null, ['en-US', 'ru-RU']), 'ru')
  assert.equal(resolveLocale(null, ['de-DE']), 'en')
})

test('English and Russian catalogs translate checklist actors, activity, source fallback, and refresh', () => {
  // Several of these keys are built at runtime (`activity.${action}`), where the scan of
  // written-out keys above cannot see them. The words are the owner's to edit: what holds
  // is that each key reads in its own language and keeps the count it is given.
  const keys = [
    'activity.claimed',
    'activity.checklistClaimed',
    'workItem.noClaim',
    'workItem.claim',
    'refresh.title',
    'workItem.view.kanban',
    'workItem.listEmpty',
    'workItem.noSpace',
    'settings.title',
    'alerts.event.question',
    'open.refused.no-folder',
    'session.open',
    'workItem.relations',
    'open.settings.title',
    'status.live',
    'workItem.back',
    'graph.zoomIn',
    'platform.actions.relation.remove',
    'platform.actions.resource.open',
    'platform.coreWrites.primaryOwnerRequired',
  ]
  const counted = { 'graph.frontier': 2, 'graph.openOnly': 14, 'graph.showDone': 105 }
  // English carries a letter and no Cyrillic one; Russian carries Cyrillic.
  const language = { en: /^(?!.*\p{Script=Cyrillic}).*\p{L}/su, ru: /\p{Script=Cyrillic}/u }
  for (const locale of ['en', 'ru'] as const) {
    i18n.global.locale.value = locale
    for (const key of keys) {
      const text = i18n.global.t(key)
      assert.notEqual(text, key, `${locale}: ${key} does not resolve`)
      assert.match(text, language[locale], `${locale}: ${key} reads «${text}»`)
    }
    for (const [key, count] of Object.entries(counted)) {
      const text = i18n.global.t(key, { count })
      assert.match(text, language[locale], `${locale}: ${key} reads «${text}»`)
      assert.ok(text.split(/\D+/u).includes(String(count)), `${locale}: ${key} drops ${count}`)
    }
  }
  i18n.global.locale.value = 'en'
})

test('a counted Russian message takes the form its number asks for, and English its two', () => {
  // A number stays on the line of its unit; the forms are what is compared here.
  const read = (key: string, count: number) =>
    i18n.global.t(`workItem.chain.forecast.${key}`, { count }, count).replaceAll('\u{A0}', ' ')
  const days = (count: number) => read('day', count)
  const weeks = (count: number) => read('week', count)
  i18n.global.locale.value = 'ru'
  assert.deepEqual(
    [1, 2, 4, 5, 11, 12, 21, 22, 25, 111].map((count) => days(count)),
    [
      '1 день',
      '2 дня',
      '4 дня',
      '5 дней',
      '11 дней',
      '12 дней',
      '21 день',
      '22 дня',
      '25 дней',
      '111 дней',
    ],
  )
  assert.deepEqual(
    [1, 3, 6].map((count) => weeks(count)),
    ['1 неделю', '3 недели', '6 недель'],
  )
  i18n.global.locale.value = 'en'
  assert.deepEqual(
    [1, 2, 21].map((count) => days(count)),
    ['1 day', '2 days', '21 days'],
  )
})

test('readiness has one label in each language, wherever it is printed', () => {
  // It had three: «Готово к работе» in the queue, which also reads as done,
  // «можно брать» on a tile and «Можно брать сейчас» on the graph. «Готово к работе»
  // is the name of a category now, and readiness keeps a word apart from it.
  const values = (catalog: unknown): string[] =>
    catalog && typeof catalog === 'object'
      ? Object.values(catalog as Record<string, unknown>).flatMap((child) => values(child))
      : [String(catalog)]
  for (const locale of ['en', 'ru'] as const) {
    const catalog = messages[locale]
    const label = catalog.workItem.facet.ready
    assert.equal(catalog.graph.frontier, `${label} · {count}`, locale)
    assert.notEqual(label, catalog.workItem.category.ready, locale)
    for (const retired of ['Можно брать сейчас', 'Workable now', 'Ready to work'])
      assert.ok(!values(catalog).some((value) => value.includes(retired)), `${locale}: ${retired}`)
    // A mark that reads as the label is the label, not a lowercase second copy
    // of it; inside a sentence the words stay lowercase («…; можно брать 3»).
    assert.deepEqual(
      values(catalog).filter(
        (value) => value !== label && value.toLowerCase() === label.toLowerCase(),
      ),
      [],
      locale,
    )
  }
})

/** Every text of a catalogue by its whole key. */
function texts(value: unknown, prefix = ''): [string, string][] {
  return value && typeof value === 'object'
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        texts(child, prefix ? `${prefix}.${key}` : key),
      )
    : [[prefix, String(value)]]
}

test('a point of acceptance is a condition in both languages, never a step of a checklist', () => {
  // The owner's word for it is «Условия», «Следующее условие»; the card and the list said
  // «Чек-лист», «Шаги», «Следующий шаг» and «Все шаги». A step of the plan that opens a
  // session is another thing, and so is an app «out of step» with the server; a placeholder
  // is a name in the code, not a word on the screen.
  const elsewhere = new Set([
    'open.refused.invalid-step',
    'health.finding.desktop-app-differs.title',
  ])
  const retired = { ru: /чек-лист|шаг/iu, en: /checklist|\bsteps?\b/iu }
  for (const locale of ['en', 'ru'] as const) {
    const said = texts(messages[locale])
      .filter(([key]) => !elsewhere.has(key))
      .filter(([, text]) => retired[locale].test(text.replaceAll(/\{\w+\}/gu, '')))
    assert.deepEqual(said, [], locale)
  }
  assert.equal(messages.ru.workItem.checklist, 'Условия')
  assert.equal(messages.ru.workItem.list.checklist, 'Условия')
  assert.equal(messages.ru.workItem.nextStep.label, 'Следующее условие')
  assert.equal(messages.en.workItem.checklist, 'Conditions')
})
