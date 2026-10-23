import { afterEach, expect, it, vi } from 'vitest'

import { subscribePlanning } from '@/shared/api/planningApi.ts'

import { planningReadModel, projectId, spaceRef } from './browser/planningFixtures.ts'

const sources: Source[] = []
class Source extends EventTarget {
  close = vi.fn()
  constructor(readonly url: string) {
    super()
    sources.push(this)
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function subscription() {
  vi.stubGlobal('EventSource', Source)
  const callbacks = { snapshot: vi.fn(), connection: vi.fn(), invalid: vi.fn() }
  const close = subscribePlanning({ project: projectId, ...spaceRef }, callbacks)
  const source = sources.at(-1)
  if (!source) throw new Error('Expected an event source')
  return { source, callbacks, close }
}

it('subscribes to the exact project and store and commits validated snapshots', () => {
  const { source, callbacks, close } = subscription()
  const url = new URL(source.url, 'http://127.0.0.1')
  expect(Object.fromEntries(url.searchParams)).toEqual({
    view: 'planning',
    project: projectId,
    ...spaceRef,
  })
  expect(callbacks.connection).toHaveBeenLastCalledWith('connecting')
  source.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(planningReadModel) }))
  expect(callbacks.snapshot).toHaveBeenCalledWith(planningReadModel)
  expect(callbacks.connection).toHaveBeenLastCalledWith('live')
  source.dispatchEvent(new Event('error'))
  expect(callbacks.connection).toHaveBeenLastCalledWith('reconnecting')
  source.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(planningReadModel) }))
  expect(callbacks.connection).toHaveBeenLastCalledWith('live')
  close()
})

it('rejects malformed or differently named spaces and closes the invalid source', () => {
  for (const value of [
    {},
    { ...planningReadModel, planning_space: { ...planningReadModel.planning_space, key: 'OTHER' } },
  ]) {
    const { source, callbacks, close } = subscription()
    source.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
    expect(callbacks.snapshot).not.toHaveBeenCalled()
    expect(callbacks.invalid).toHaveBeenCalledOnce()
    expect(callbacks.connection).toHaveBeenLastCalledWith('reconnecting')
    expect(source.close).toHaveBeenCalledOnce()
    close()
    expect(source.close).toHaveBeenCalledOnce()
  }
})

it('disposes the source and ignores callbacks already queued for the previous scope', () => {
  const { source, callbacks, close } = subscription()
  close()
  source.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(planningReadModel) }))
  source.dispatchEvent(new Event('error'))
  expect(callbacks.snapshot).not.toHaveBeenCalled()
  expect(callbacks.connection.mock.calls).toEqual([['connecting']])
  expect(source.close).toHaveBeenCalledOnce()
})

it('reports a silent initial stream without replacing native reconnection and accepts recovery', () => {
  vi.useFakeTimers()
  const { source, callbacks, close } = subscription()
  vi.advanceTimersByTime(15_000)
  expect(callbacks.connection).toHaveBeenLastCalledWith('reconnecting')
  expect(source.close).not.toHaveBeenCalled()
  source.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(planningReadModel) }))
  expect(callbacks.connection).toHaveBeenLastCalledWith('live')
  close()
  expect(vi.getTimerCount()).toBe(0)
})

it('cleans up the initial stream deadline on scope disposal', () => {
  vi.useFakeTimers()
  const { callbacks, close } = subscription()
  close()
  vi.advanceTimersByTime(15_000)
  expect(callbacks.connection.mock.calls).toEqual([['connecting']])
  expect(vi.getTimerCount()).toBe(0)
})
