import { describe, expect, it } from 'vitest'

import { documentPageAddress, documentPageHref } from '@/shared/api/documentPage.ts'

const ORIGIN = 'http://127.0.0.1:8642'
const read = (href: string) => documentPageAddress(new URL(href, ORIGIN))

describe('the address of a document page', () => {
  it('names a project, a path and an anchor', () => {
    expect(read('/doc?project=demo&path=docs%2Fplan.md#kb:a7f3')).toEqual({
      project: 'demo',
      path: 'docs/plan.md',
      suffix: '#kb:a7f3',
    })
    expect(read('/doc?project=demo&path=docs/plan.md')?.suffix).toBe('')
  })

  it.each([
    ['/docs?project=demo&path=a.md'],
    ['/doc/?project=demo&path=a.md'],
    ['/doc/a.md?project=demo&path=a.md'],
    ['/modules/planning/global'],
    ['/doc'],
    ['/doc?project=demo'],
    ['/doc?path=a.md'],
    ['/doc?project=&path=a.md'],
    ['/doc?project=demo&path='],
  ])('reads %s as no document', (href) => {
    expect(read(href)).toBeNull()
  })

  it('takes the anchor as a text wrote it, and one it cannot decode as it stands', () => {
    expect(read('/doc?project=demo&path=a.md#%D1%87%D0%B0%D1%81%D1%82%D1%8C-2')?.suffix).toBe(
      '#часть-2',
    )
    expect(read('/doc?project=demo&path=a.md#100%')?.suffix).toBe('#100%')
  })

  it.each([
    ['', ''],
    ['#kb:a7f3', '#kb:a7f3'],
    ['#part-two', '#part-two'],
    ['#L14', '#L14'],
    ['#L14-L20', '#L14-L20'],
    [':42', '#L42'],
    [':42-50', '#L42-L50'],
    [':42:7', '#L42'],
    ['#часть-2', '#часть-2'],
  ])('writes the suffix %j as the fragment %j, and reads it back', (suffix, fragment) => {
    const href = documentPageHref({ project: 'demo', path: 'docs/plan.md', suffix })
    expect(href).toBe(`/doc?project=demo&path=docs%2Fplan.md${fragment}`)
    expect(read(href)).toEqual({ project: 'demo', path: 'docs/plan.md', suffix: fragment })
  })

  it('carries a path through whatever it is spelled with', () => {
    for (const path of ['docs/с пробелом и кириллицей.md', 'a&b=c.md', 'a#b?c.md', 'a+b%20c.md']) {
      const place = { project: 'my project', path, suffix: '#kb:x' }
      expect(read(documentPageHref(place))).toEqual(place)
    }
  })
})
