'use strict'

// Which attention items deserve a Windows toast right now. The renderer already
// holds the live session stream, so it reports the inbox and this decides what
// is new: a notification must fire once per reason, not once per stream push.

const MAX_TOASTS_PER_PUSH = 3
const MAX_LABEL = 90

/** One reason on one session. A new reason on the same session notifies again. */
function attentionKey(item) {
  return `${item.id} ${item.attention}`
}

/** Printable, trimmed text for a toast; control characters break its layout. */
function text(value) {
  if (typeof value !== 'string') return ''
  let out = ''
  for (const character of value) {
    const code = character.codePointAt(0)
    out += code < 0x20 || code === 0x7f ? ' ' : character
  }
  return out.trim()
}

/**
 * Decide the toasts for one reported inbox.
 *
 * `known` is the set of keys already notified. The returned keys describe only
 * what is in the inbox now, so a session that was acknowledged and later rings
 * again notifies once more instead of staying silent forever.
 */
function newAttention(known, inbox) {
  const items = Array.isArray(inbox) ? inbox : []
  const present = new Set()
  const fresh = []
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id) continue
    if (!text(item.attention)) continue
    if (item.attention_seen) continue
    const key = attentionKey(item)
    present.add(key)
    if (!known.has(key)) fresh.push(item)
  }
  // Sixteen parallel sessions ending at once must not raise sixteen toasts; the
  // remainder is summarized in one more and the panel carries the detail.
  const shown = fresh.slice(0, MAX_TOASTS_PER_PUSH)
  const hidden = fresh.length - shown.length
  const toasts = shown.map((item) => ({
    key: attentionKey(item),
    title: `${text(item.client) || 'agent'} · ${text(item.attention)}`,
    body: (text(item.label) || text(item.cwd) || item.id).slice(0, MAX_LABEL),
  }))
  if (hidden > 0) {
    toasts.push({
      key: 'summary',
      title: 'Valkama',
      body: `${hidden} more session(s) need attention`,
    })
  }
  return { toasts, keys: present }
}

module.exports = { newAttention, attentionKey, MAX_TOASTS_PER_PUSH }
