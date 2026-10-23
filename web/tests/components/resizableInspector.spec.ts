import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import ResizableInspector from '@/shared/ui/ResizableInspector.vue'

const storageKey = 'test-inspector-overlay-width'

afterEach(() => {
  localStorage.removeItem(storageKey)
})

describe('resizable inspector overlay', () => {
  it('teleports out of its workspace, closes on Escape and restores its opener', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const workspace = document.createElement('div')
    document.body.append(workspace)
    const wrapper = mount(ResizableInspector, {
      attachTo: workspace,
      props: { label: 'Подробное описание задачи', open: true, storageKey },
      slots: { default: '<button class="inspector-action">Сохранить результат</button>' },
    })
    await flushPromises()
    const surface = document.querySelector('[role="dialog"]')
    expect(surface?.getAttribute('aria-label')).toBe('Подробное описание задачи')
    expect(workspace.contains(surface)).toBe(false)
    const action = document.querySelector<HTMLButtonElement>('.inspector-action')
    expect(surface?.contains(document.activeElement)).toBe(true)
    action?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
    workspace.remove()
    opener.remove()
  })

  it('keeps keyboard resizing and persisted width through the shared drawer', async () => {
    const wrapper = mount(ResizableInspector, {
      attachTo: document.body,
      props: { label: 'Task', resizeLabel: 'Resize task panel', open: true, storageKey },
      slots: { default: '<button>Close</button>' },
    })
    await flushPromises()
    const separator = document.querySelector('[role="separator"]')
    expect(separator?.getAttribute('aria-label')).toBe('Resize task panel')
    expect(separator?.getAttribute('aria-valuenow')).toBe('620')
    separator?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await flushPromises()
    expect(separator?.getAttribute('aria-valuenow')).toBe('636')
    expect(localStorage.getItem(storageKey)).toBe('636')
    separator?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    await flushPromises()
    expect(separator?.getAttribute('aria-valuenow')).toBe('360')
    wrapper.unmount()
    await flushPromises()
  })
})
