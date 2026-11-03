'use strict'

// What a right click offers in the window. Chromium draws no context menu in an
// Electron window until the app builds one, so a link could not be copied and
// selected text only through the keyboard: the window has no address bar either.
//
// The menu offers only what applies where the click landed. A link offers its
// address; selected text, Copy; a field, the editing four, each enabled as the
// field allows. The editing items are Electron's own roles, so the renderer does
// the work and nothing here touches what the page holds. A click on nothing of
// that kind opens no menu at all.

const LABELS = {
  en: {
    copyLink: 'Copy link address',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
  },
  ru: {
    copyLink: 'Копировать адрес ссылки',
    cut: 'Вырезать',
    copy: 'Копировать',
    paste: 'Вставить',
    selectAll: 'Выделить всё',
  },
}

/** The language the page says it speaks, or null when it names neither of ours. */
function pageLocale(lang) {
  return lang === 'en' || lang === 'ru' ? lang : null
}

/**
 * The menu for one right click, as a `Menu.buildFromTemplate` template.
 *
 * `params` is the `context-menu` event's; `copyText` puts a string on the
 * clipboard. An empty template means no menu.
 */
function contextMenuTemplate(params, locale, copyText) {
  const words = LABELS[locale] ?? LABELS.en
  const flags = params.editFlags ?? {}
  const groups = []
  if (params.linkURL) {
    groups.push([{ id: 'copy-link', label: words.copyLink, click: () => copyText(params.linkURL) }])
  }
  if (params.isEditable) {
    groups.push(
      [
        { role: 'cut', label: words.cut, enabled: Boolean(flags.canCut) },
        { role: 'copy', label: words.copy, enabled: Boolean(flags.canCopy) },
        { role: 'paste', label: words.paste, enabled: Boolean(flags.canPaste) },
      ],
      [{ role: 'selectAll', label: words.selectAll, enabled: Boolean(flags.canSelectAll) }],
    )
  } else if (params.selectionText?.trim()) {
    groups.push([{ role: 'copy', label: words.copy }])
  }
  return groups.flatMap((group, index) => (index === 0 ? group : [{ type: 'separator' }, ...group]))
}

module.exports = { contextMenuTemplate, pageLocale }
