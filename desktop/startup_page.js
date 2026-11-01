'use strict'

// The page the window shows before Valkama itself can: while the server is
// being found or started, and when it cannot be, with the remedy. It is the
// first thing the owner sees after a click, so it paints at once, in the
// product's palette and language, from a data URL that needs no server.
//
// A remedy is a link to `ACTION_ORIGIN`, which the main process intercepts in
// `will-navigate` and never lets load: the page asks, the main process decides.
// No IPC is exposed to this page, so nothing it runs can reach the shell.

const ACTION_ORIGIN = 'https://valkama.invalid/'

// Mirrors of tokens.css, written by web/scripts/sync-tokens.mjs from the map
// below. A data URL resolves no custom property, so the values are literal.
const PAGE_COLORS = {
  background: '#030405',
  raised: '#191a1b',
  text: '#ececec',
  muted: '#c4c4c4',
  rule: 'rgb(255 255 255 / 8%)',
  action: '#ececec',
  actionText: '#0d0d0d',
  control: '#3d3d3d',
  focus: '#7cacf8',
  info: '#7cacf8',
  danger: '#f99a8f',
  warning: '#d9b06a',
}
const PAGE_TOKENS = {
  background: '--color-navigation',
  raised: '--color-navigation-raised',
  text: '--color-text',
  muted: '--color-text-muted',
  rule: '--color-rule',
  action: '--color-action-primary',
  actionText: '--color-text-on-action',
  control: '--color-control-surface',
  focus: '--color-focus-ring',
  info: '--color-info',
  danger: '--color-danger',
  warning: '--color-warning',
}

const MESSAGES = {
  en: {
    starting: 'Starting Valkama…',
    startingDetail: 'Checking the local server.',
    restarting: 'Restarting the server…',
    restartingDetail: 'Agent sessions are not affected.',
    staleTitle: 'The running Valkama server is out of date',
    staleFrontEnd: 'A newer front end has been built since it started.',
    staleServerCode: 'Its server code has changed since it started.',
    staleIdentity: 'Its runtime identity no longer matches the managed launcher.',
    staleUnreadable: 'It does not report a readable runtime identity.',
    staleRemedy: 'Restart it to open the current version. Agent sessions are not affected.',
    restart: 'Restart the server',
    failedTitle: 'Valkama could not start',
    foreignRemedy:
      'Port {port} is held by a process the Valkama launcher did not start. Valkama left it untouched. Stop that process or choose another port, then try again.',
    unverifiedRemedy:
      'Valkama could not verify who owns port {port}, so it left the listener untouched. Try again in a moment.',
    launcherRemedy:
      'Reinstall the managed launcher from the current checkout: python valkama.py launcher install',
    serverRemedy: 'The server stopped before it was ready. Its last words are below.',
    genericRemedy: 'Try again. If it keeps failing, the details below say why.',
    retry: 'Try again',
    details: 'Details',
    status: 'Status',
  },
  ru: {
    starting: 'Запускаем Valkama…',
    startingDetail: 'Проверяем локальный сервер.',
    restarting: 'Перезапускаем сервер…',
    restartingDetail: 'Сессии агентов это не затронет.',
    staleTitle: 'Запущенный сервер Valkama устарел',
    staleFrontEnd: 'После его запуска собран новый интерфейс.',
    staleServerCode: 'После его запуска изменился код сервера.',
    staleIdentity: 'Его версия больше не совпадает с управляемым лаунчером.',
    staleUnreadable: 'Он не сообщает свою версию.',
    staleRemedy: 'Перезапустите его, чтобы открыть текущую версию. Сессии агентов это не затронет.',
    restart: 'Перезапустить сервер',
    failedTitle: 'Valkama не запустилась',
    foreignRemedy:
      'Порт {port} занят процессом, который запустил не лаунчер Valkama. Valkama его не трогала. Остановите этот процесс или выберите другой порт и повторите.',
    unverifiedRemedy:
      'Valkama не смогла проверить, кто занимает порт {port}, и не стала трогать этот процесс. Повторите через несколько секунд.',
    launcherRemedy:
      'Переустановите управляемый лаунчер из текущего checkout: python valkama.py launcher install',
    serverRemedy: 'Сервер остановился, не успев запуститься. Его последний вывод — ниже.',
    genericRemedy: 'Повторите. Если не поможет, причина — в подробностях ниже.',
    retry: 'Повторить',
    details: 'Подробности',
    status: 'Состояние',
  },
}

const STALE_REASONS = {
  'front-end': 'staleFrontEnd',
  'server-code': 'staleServerCode',
  'identity': 'staleIdentity',
  'unreadable': 'staleUnreadable',
}

const FAILURE_REMEDIES = {
  'foreign': 'foreignRemedy',
  'unverified': 'unverifiedRemedy',
  'launcher': 'launcherRemedy',
  'server-exited': 'serverRemedy',
}

/** The web UI's rule, so the window speaks the language the workspace will. */
function resolveLocale(stored, languages) {
  if (stored === 'en' || stored === 'ru') return stored
  return (languages || []).some((language) => String(language).toLowerCase().startsWith('ru'))
    ? 'ru'
    : 'en'
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  )
}

/** What a remedy link asks for, or null when the URL is not one. */
function startupAction(url) {
  if (typeof url !== 'string' || !url.startsWith(ACTION_ORIGIN)) return null
  const action = url.slice(ACTION_ORIGIN.length)
  return action === 'restart' || action === 'retry' ? action : null
}

/**
 * What the page says and offers for one state.
 *
 * `starting` and `restarting` are progress; `stale` offers the restart, which
 * only a managed listener ever reaches; `failed` names its remedy by `kind`
 * and always offers to try again.
 */
function startupView(state) {
  const locale = MESSAGES[state.locale] ? state.locale : 'en'
  const text = MESSAGES[locale]
  const port = String(state.port ?? '')
  const fill = (message) => message.replaceAll('{port}', port)
  if (state.phase === 'starting' || state.phase === 'restarting') {
    return {
      locale,
      tone: 'info',
      busy: true,
      title: text[state.phase],
      lines: [text[`${state.phase}Detail`]],
      detail: '',
      actions: [],
    }
  }
  if (state.phase === 'stale') {
    const reasons = (state.reasons || [])
      .map((reason) => text[STALE_REASONS[reason]])
      .filter(Boolean)
    return {
      locale,
      tone: 'warning',
      busy: false,
      title: text.staleTitle,
      lines: [...(reasons.length ? reasons : [text.staleIdentity]), text.staleRemedy],
      detail: state.detail || '',
      actions: [{ action: 'restart', label: text.restart, primary: true }],
    }
  }
  return {
    locale,
    tone: 'danger',
    busy: false,
    title: text.failedTitle,
    lines: [fill(text[FAILURE_REMEDIES[state.kind]] || text.genericRemedy)],
    detail: state.detail || '',
    actions: [{ action: 'retry', label: text.retry, primary: true }],
  }
}

function renderStartupPage(state) {
  const view = startupView(state)
  const text = MESSAGES[view.locale]
  const c = PAGE_COLORS
  const lines = view.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
  const detail = view.detail
    ? `<details${view.tone === 'danger' ? ' open' : ''}><summary>${escapeHtml(text.details)}</summary><pre>${escapeHtml(view.detail)}</pre></details>`
    : ''
  const actions = view.actions.length
    ? `<div class="actions">${view.actions
        .map(
          (item, index) =>
            `<a class="button${item.primary ? ' primary' : ''}" href="${ACTION_ORIGIN}${item.action}"${index === 0 ? ' autofocus' : ''}>${escapeHtml(item.label)}</a>`,
        )
        .join('')}</div>`
    : ''
  const role = view.busy ? 'status' : 'alert'
  return `<!doctype html>
<html lang="${view.locale}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Valkama</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  display: grid; place-items: center; padding: 32px;
  background: ${c.background}; color: ${c.text};
  font: 400 14px/1.5 'Inter Variable', 'Segoe UI', system-ui, sans-serif;
}
main { width: min(560px, 100%); display: grid; gap: 12px; }
/* Progress fades in late: a server that is already up replaces this page
   before it would be read, and a flash of "starting" is noise. */
main[aria-busy="true"] { animation: appear 160ms ease-out 240ms both; }
@keyframes appear { from { opacity: 0; } }
.brand { margin: 0 0 12px; font-size: 13px; font-weight: 600; color: ${c.muted}; letter-spacing: 0.02em; }
h1 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.35; display: flex; align-items: center; gap: 8px; }
h1::before { content: ''; flex: none; width: 8px; height: 8px; border-radius: 50%; background: ${c[view.tone]}; }
main[aria-busy="true"] h1::before { background: none; width: 12px; height: 12px; border: 2px solid ${c.rule}; border-top-color: ${c.info}; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  main[aria-busy="true"] { animation-duration: 1ms; }
  main[aria-busy="true"] h1::before { animation: none; border-color: ${c.info}; }
}
p { margin: 0; color: ${c.muted}; }
details { margin-top: 4px; border-top: 1px solid ${c.rule}; padding-top: 12px; }
summary { cursor: pointer; color: ${c.muted}; font-size: 13px; }
pre { margin: 8px 0 0; padding: 12px; border-radius: 8px; background: ${c.raised}; color: ${c.text}; font: 400 12px/1.5 'Cascadia Mono', consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 40vh; overflow: auto; }
.actions { display: flex; gap: 8px; margin-top: 8px; }
.button { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border-radius: 8px; background: ${c.control}; color: ${c.text}; font-weight: 500; text-decoration: none; }
.button.primary { background: ${c.action}; color: ${c.actionText}; }
.button:focus-visible, summary:focus-visible { outline: 2px solid ${c.focus}; outline-offset: 2px; }
</style>
</head>
<body>
<main role="${role}" aria-busy="${view.busy}" aria-label="${escapeHtml(text.status)}">
<p class="brand">Valkama</p>
<h1>${escapeHtml(view.title)}</h1>
${lines}
${actions}
${detail}
</main>
</body>
</html>`
}

function startupPageUrl(state) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(renderStartupPage(state))}`
}

module.exports = {
  ACTION_ORIGIN,
  PAGE_COLORS,
  renderStartupPage,
  resolveLocale,
  startupAction,
  startupPageUrl,
  startupView,
}
