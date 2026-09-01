import assert from 'node:assert/strict'

import { test } from 'vitest'

import { renderSkillMarkdown } from '@/entities/skill/utils/skillMarkdown.ts'

test('renders useful Markdown without executable HTML, images, or unsafe links', () => {
  const html = renderSkillMarkdown(`
# Review

<script>alert(1)</script>

[Safe](https://example.com) [Unsafe](javascript:alert(1)) ![Tracker](https://example.com/pixel.png)
`)
  assert.match(html, /<h1>Review<\/h1>/)
  assert.doesNotMatch(html, /<script|<img|href="javascript:/i)
  assert.match(html, /rel="noopener noreferrer"/)
})
