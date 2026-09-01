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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>)
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
  // A floor, so a regex that stops matching cannot pass as a clean scan.
  assert.ok(seen.size > 400, `the scan found only ${seen.size} keys written out`)
})

test('every section that derives its intro key has one to derive', () => {
  // `RegistrySection` spells a section's intro as its title key plus `Intro`, so
  // the key exists nowhere in the source as text. Two of them were deleted as
  // unreachable and came back as raw keys on the Settings screen; nothing in the
  // scan above can see them, which is why this case names the derivation.
  const derived: string[] = []
  for (const relative of sourceFiles()) {
    const source = fs.readFileSync(path.join(SRC, relative), 'utf8')
    for (const match of source.matchAll(/title-key="([A-Za-z0-9_.]+)"/g)) derived.push(match[1])
  }
  assert.ok(derived.length > 0, 'no section declares a title key')
  const missing = derived.flatMap((key) =>
    [key, `${key}Intro`].filter((candidate) => !resolves(messages.en, candidate)),
  )
  assert.deepEqual(missing, [])
})

test('locale resolution prefers an explicit saved language, then Russian browser preference', () => {
  assert.equal(resolveLocale('en', ['ru-RU']), 'en')
  assert.equal(resolveLocale('ru', ['en-US']), 'ru')
  assert.equal(resolveLocale(null, ['en-US', 'ru-RU']), 'ru')
  assert.equal(resolveLocale(null, ['de-DE']), 'en')
})

test('English and Russian catalogs translate checklist actors, activity, source fallback, and refresh', () => {
  i18n.global.locale.value = 'en'
  assert.equal(i18n.global.t('activity.claimed'), 'Work claimed')
  assert.equal(i18n.global.t('notifications.title'), 'Agent action log')
  assert.equal(i18n.global.t('workItem.noClaim'), 'No active claim')
  assert.equal(i18n.global.t('activity.checklistClaimed'), 'Checklist item claimed')
  assert.equal(i18n.global.t('workItem.claim'), 'Claim')
  // The tooltip, not a caption: the connection strip is the refresh control and
  // says so by its icon, so the word only exists as the control's own name.
  assert.equal(i18n.global.t('refresh.title'), 'Refresh boards, activity, and the current view now')
  assert.equal(i18n.global.t('monitor.title'), 'Session monitor')
  assert.equal(i18n.global.t('monitor.lastActivityMinutes', { count: 4 }), 'Activity 4m ago')
  assert.equal(i18n.global.t('monitor.attention.blocked'), 'Needs input')
  assert.equal(i18n.global.t('workItem.view.kanban'), 'Kanban')
  assert.equal(i18n.global.t('graph.frontier', { count: 2 }), 'Workable now · 2')
  assert.equal(i18n.global.t('graph.openOnly', { count: 14 }), 'Open · 14')
  assert.equal(i18n.global.t('graph.showDone', { count: 105 }), 'Show done · 105')
  assert.equal(i18n.global.t('monitor.attention.waiting'), 'Waiting for you')
  assert.equal(i18n.global.t('workItem.listEmpty'), 'This space has no work items yet.')
  assert.equal(i18n.global.t('workItem.noSpace'), 'This project has no planning space yet.')
  assert.equal(i18n.global.t('settings.title'), 'Valkama settings')
  assert.equal(i18n.global.t('settings.event.agentWaiting'), 'Agent ends every turn (noisy)')
  assert.equal(i18n.global.t('notify.more', { count: 3 }), '3 more events')
  assert.equal(i18n.global.t('notify.sessionEnded'), 'Session finished')
  assert.equal(
    i18n.global.t('session.refused.no-cwd'),
    'This session reported no working directory to open.',
  )
  assert.equal(i18n.global.t('session.open'), 'Open session')
  assert.equal(i18n.global.t('workItem.relations'), 'Relations')
  assert.equal(i18n.global.t('dashboard.notRecorded'), 'Not recorded')
  assert.equal(
    i18n.global.t('session.refused.space-root-unavailable'),
    'The exact Planning-space root is unavailable; the observed session directory is not launch authority.',
  )
  assert.equal(i18n.global.t('improvements.cancel'), 'Cancel')
  assert.equal(i18n.global.t('improvements.state.running'), 'Running')
  assert.equal(i18n.global.t('status.live'), 'Connected')
  assert.equal(i18n.global.t('workItem.back'), 'Back')
  assert.equal(i18n.global.t('dashboard.toolUsage'), 'Tool and MCP usage')
  assert.equal(i18n.global.t('graph.zoomIn'), 'Zoom in')
  assert.equal(i18n.global.t('dashboard.dataQuality'), 'Data quality')
  assert.equal(i18n.global.t('dashboard.unclassifiedCalls'), 'Unclassified')
  assert.equal(i18n.global.t('improvements.disabled'), 'Disabled')
  assert.equal(
    i18n.global.t('improvements.activationReady'),
    'Evidence is available. You can choose to run analysis manually.',
  )
  assert.equal(i18n.global.t('platform.actions.relation.remove'), 'Remove')
  assert.equal(i18n.global.t('platform.actions.resource.open'), 'Open')
  assert.match(i18n.global.t('platform.analytics.noMappedProjects'), /Bind a project/)
  assert.match(i18n.global.t('platform.coreWrites.primaryOwnerRequired'), /writable primary store/)
  assert.match(i18n.global.t('platform.relations.confirmOpen'), /opening this exact target/)
  assert.match(i18n.global.t('platform.relations.confirmRemove'), /exact target/)

  i18n.global.locale.value = 'ru'
  assert.equal(i18n.global.t('activity.claimed'), 'Работа взята')
  assert.equal(i18n.global.t('notifications.title'), 'Журнал действий агентов')
  assert.equal(i18n.global.t('workItem.claim'), 'Взять')
  assert.equal(i18n.global.t('activity.checklistClaimed'), 'Пункт чек-листа взят в работу')
  assert.equal(i18n.global.t('workItem.noClaim'), 'Никто не взял')
  assert.equal(i18n.global.t('refresh.title'), 'Обновить доски, активность и текущий вид сейчас')
  assert.equal(i18n.global.t('platform.relations.title'), 'Связи')
  assert.equal(i18n.global.t('monitor.title'), 'Монитор сессий')
  assert.equal(
    i18n.global.t('monitor.lastActivityMinutes', { count: 4 }),
    'Активность 4 мин. назад',
  )
  assert.equal(i18n.global.t('monitor.attention.blocked'), 'Нужен ответ')
  assert.equal(i18n.global.t('workItem.view.kanban'), 'Канбан')
  assert.equal(i18n.global.t('graph.frontier', { count: 2 }), 'Можно брать сейчас · 2')
  assert.equal(i18n.global.t('graph.openOnly', { count: 14 }), 'Открытые · 14')
  assert.equal(i18n.global.t('graph.showDone', { count: 105 }), 'Показать готовые · 105')
  assert.equal(i18n.global.t('monitor.attention.waiting'), 'Ждёт ответа')
  assert.equal(i18n.global.t('workItem.listEmpty'), 'В этом пространстве ещё нет работы.')
  assert.equal(
    i18n.global.t('workItem.noSpace'),
    'У этого проекта пока нет пространства планирования.',
  )
  assert.equal(i18n.global.t('settings.title'), 'Настройки Valkama')
  assert.equal(i18n.global.t('settings.event.agentWaiting'), 'Агент завершил каждый ход (шумно)')
  assert.equal(i18n.global.t('notify.more', { count: 3 }), 'Ещё событий: 3')
  assert.equal(i18n.global.t('notify.sessionEnded'), 'Сессия завершилась')
  assert.equal(i18n.global.t('session.refused.no-cwd'), 'Сессия не сообщила рабочий каталог.')
  assert.equal(i18n.global.t('session.open'), 'Открыть сессию')
  assert.equal(i18n.global.t('workItem.relations'), 'Связи')
  assert.equal(i18n.global.t('dashboard.notRecorded'), 'Не записано')
  assert.equal(
    i18n.global.t('session.refused.space-root-unavailable'),
    'Корень точного пространства планирования недоступен; наблюдаемый каталог сессии не даёт права запуска.',
  )
  assert.equal(i18n.global.t('improvements.cancel'), 'Отменить')
  assert.equal(i18n.global.t('improvements.state.running'), 'Выполняется')
  assert.equal(i18n.global.t('status.live'), 'Подключено')
  assert.equal(i18n.global.t('workItem.back'), 'Назад')
  assert.equal(i18n.global.t('dashboard.toolUsage'), 'Использование инструментов и MCP')
  assert.equal(i18n.global.t('graph.zoomIn'), 'Приблизить')
  assert.equal(i18n.global.t('dashboard.dataQuality'), 'Качество данных')
  assert.equal(i18n.global.t('dashboard.unclassifiedCalls'), 'Не классифицировано')
  assert.equal(i18n.global.t('improvements.disabled'), 'Выключен')
  assert.equal(
    i18n.global.t('improvements.activationReady'),
    'Свидетельства доступны. Анализ можно запустить вручную.',
  )
  assert.equal(i18n.global.t('platform.actions.relation.remove'), 'Удалить')
  assert.equal(i18n.global.t('platform.actions.resource.open'), 'Открыть')
  assert.match(i18n.global.t('platform.analytics.noMappedProjects'), /Привяжите проект/)
  assert.match(i18n.global.t('platform.coreWrites.primaryOwnerRequired'), /основное хранилище/)
  assert.match(i18n.global.t('platform.relations.confirmOpen'), /открытие этой точной цели/)
  assert.match(i18n.global.t('platform.relations.confirmRemove'), /точной цели/)

  i18n.global.locale.value = 'en'
})
