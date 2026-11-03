/**
 * The shell's document opener: a file or a folder a text names goes to the
 * editor by the open plan, and the result is said; a refused plan answers false,
 * which leaves the links to copy the path.
 */
import { createPinia } from 'pinia'
import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDocumentOpening } from '@/app/composables/useDocumentOpening.ts'

import type { DocumentOpener } from '@/entities/project-document/documentLinks.ts'

import { messages } from '@/shared/i18n/index.ts'

const provided = vi.hoisted(() => ({ opener: null as DocumentOpener | null }))
const openTarget = vi.hoisted(() => vi.fn())

vi.mock('@/entities/project-document/documentLinks.ts', () => ({
  provideDocumentOpener: (opener: DocumentOpener) => {
    provided.opener = opener
  },
}))
vi.mock('@/features/session-open/openPlan.ts', () => ({ openTarget }))

const renderNothing = () => null

function mountOpening(say: (message: string) => void) {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
  const Host = defineComponent({
    setup() {
      useDocumentOpening(say)
      return renderNothing
    },
  })
  mount(Host, { global: { plugins: [createPinia(), i18n] } })
  if (!provided.opener) throw new Error('no opener was provided')
  return provided.opener
}

describe('the shell document opener', () => {
  beforeEach(() => {
    localStorage.clear()
    provided.opener = null
    openTarget.mockReset()
  })

  it('opens a file at its line in the editor and says where', async () => {
    const say = vi.fn()
    openTarget.mockResolvedValue({
      status: 'opened',
      notice: null,
      opens: { opened_in: 'ide', opened_host: 'vscode', source: 'fallback', missed: '' },
    })
    const opener = mountOpening(say)
    const target = { project: 'example-project', path: 'src/a.ts', line: 12, suffix: ':12' }
    expect(await opener.openFile?.(target)).toBe(true)
    expect(openTarget).toHaveBeenCalledWith({
      kind: 'file',
      project: 'example-project',
      path: 'src/a.ts',
      line: 12,
    })
    expect(say).toHaveBeenCalledWith('Opened in VS Code')
    expect(opener.editor).toBe('VS Code')
  })

  it('answers false for a refused folder, so the links copy the path', async () => {
    const say = vi.fn()
    openTarget.mockResolvedValue({ status: 'refused', refusal: { reason: 'path-refused' } })
    const opener = mountOpening(say)
    const target = { project: 'example-project', path: 'docs', line: null, suffix: '' }
    expect(await opener.openFolder?.(target)).toBe(false)
    expect(openTarget).toHaveBeenCalledWith({
      kind: 'folder',
      project: 'example-project',
      path: 'docs',
    })
    expect(say).not.toHaveBeenCalled()
  })
})
