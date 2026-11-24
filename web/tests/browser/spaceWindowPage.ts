/**
 * What the space window's specs share: the sizes and languages they run at, the words they
 * find the window's controls by, and opening «All spaces» at a size.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { globalScope } from './planningFixtures.ts'

export const SIZES = [
  { lang: 'en', width: 1280, height: 800 },
  { lang: 'en', width: 620, height: 800 },
  { lang: 'en', width: 390, height: 844 },
  { lang: 'ru', width: 1280, height: 800 },
  { lang: 'ru', width: 620, height: 800 },
  { lang: 'ru', width: 390, height: 844 },
] as const

export const WORDS = {
  en: {
    newSpace: 'New space',
    menu: 'Space actions',
    createEntry: 'New space…',
    configureEntry: 'Configure space…',
    configure: (key: string) => `Configure space ${key}`,
    configureWord: '«Configure space»',
    editTitle: (key: string) => `Space ${key}`,
    name: 'Name',
    key: 'Key',
    add: 'Add project',
    create: 'Create',
    save: 'Save',
    remove: 'Remove space',
    removeGo: 'Remove',
    retry: 'Retry binding',
    underivable: 'no key comes from this name',
    keyRule: /2 to 8 Latin letters/gu,
    renamed: 'will no longer find it',
    cancel: 'Cancel',
    nameTaken: 'Nothing was changed: another space already has this name.',
    fromFolder: 'New project from folder…',
    projectName: 'Project name',
    folder: 'Project folder',
    locked: 'does not change: it is in the numbers of its work items',
    held: 'unavailable: the default project of NW',
    keyTaken: 'Nothing was changed: another space already has this key.',
    busy: 'Space ATL was created; its projects were not bound: another command is writing the project registry right now; try again.',
  },
  ru: {
    newSpace: 'Новое пространство',
    menu: 'Действия с пространством',
    createEntry: 'Новое пространство…',
    configureEntry: 'Настроить пространство…',
    configure: (key: string) => `Настроить пространство ${key}`,
    configureWord: '«Настроить пространство»',
    editTitle: (key: string) => `Пространство ${key}`,
    name: 'Название',
    key: 'Ключ',
    add: 'Добавить проект',
    create: 'Создать',
    save: 'Сохранить',
    remove: 'Удалить пространство',
    removeGo: 'Удалить',
    retry: 'Повторить привязку',
    underivable: 'из этого имени ключ не выводится',
    keyRule: /2–8 латинских букв/gu,
    renamed: 'перестанут его находить',
    cancel: 'Отмена',
    nameTaken: 'Ничего не изменено: это имя уже у другого пространства.',
    fromFolder: 'Новый проект по папке…',
    projectName: 'Название проекта',
    folder: 'Папка проекта',
    locked: 'не меняется: он в номерах задач',
    held: 'недоступно: основной проект NW',
    keyTaken: 'Ничего не изменено: этот ключ уже у другого пространства.',
    busy: 'Пространство ATL создано, проекты не привязаны: реестр проектов сейчас пишет другая команда; повторите.',
  },
} as const

/** «All spaces» at the size's width and height, once its cards are drawn. */
export async function openPortfolio(page: Page, size: (typeof SIZES)[number]) {
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: globalScope }))
  await expect(page.locator('[data-part="configure"]').first()).toBeVisible()
}
