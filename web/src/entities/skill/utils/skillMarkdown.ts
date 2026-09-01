import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
})

markdown.validateLink = (url) => {
  const value = url.trim()
  if (value.startsWith('#')) return true
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const renderLinkOpen = markdown.renderer.rules.link_open
// markdown-it calls a renderer rule with exactly these five positions; the
// signature is theirs, and dropping one would change which value arrives where.
// eslint-disable-next-line max-params -- see above
markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  const href = tokens[index].attrGet('href') ?? ''
  if (/^https?:/i.test(href)) {
    tokens[index].attrSet('target', '_blank')
    tokens[index].attrSet('rel', 'noopener noreferrer')
  }
  return renderLinkOpen
    ? renderLinkOpen(tokens, index, options, environment, renderer)
    : renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content)

export function renderSkillMarkdown(source: string): string {
  return markdown.render(source)
}
