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
  canvas: '#181818',
  onDark: '#f2f2f2',
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
  canvas: '--color-canvas',
  onDark: '--color-text-on-dark',
}

// The mark as the shell's rail draws it: BrandMark.vue's drawing in the one ink of
// the chrome. web/tests/brandMark.test.ts holds these paths to the other renderers.
const MARK_BODY = 'M48 94L59 72L24 2H2L48 94Z'
const MARK_ACCENT =
  'M62.91 64.17L73 44H52.83L62.91 64.17ZM75 0L79.65 13.35L90.5 18L79.65 22.65L75 36L70.35 22.65L59.5 18L70.35 13.35L75 0Z'

/** The rail's width when the window has not yet heard the one the reader chose. */
const NAV_DEFAULT_WIDTH = 260
/** How long a start runs before the page says what it is waiting for. */
const STATUS_DELAY_MS = 1000

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

/**
 * While Valkama is found or started, the window already shows the shell it will open
 * on: the rail with its mark and first entries, the context bar, the empty workspace
 * panel, each where the application draws it. Nothing in it is text, because a data
 * URL cannot load the application's font, and nothing in it depends on what the
 * workspace will show, so the application replaces it without moving it. The rail
 * stands at the width the reader last chose (`navWidth`, remembered by the main
 * process from the page's storage), clamped as the application clamps it, and at its
 * icons alone where the application draws them alone. What the page is waiting for is
 * said in the panel only once a start lasts long enough to be read.
 *
 * `web/index.html` draws the same skeleton while the application's code loads.
 */
function renderSkeletonPage(view, navWidth) {
  const text = MESSAGES[view.locale]
  const c = PAGE_COLORS
  const chosen = Number(navWidth)
  const width = Number.isFinite(chosen) && chosen > 0 ? ` --sk-chosen: ${Math.round(chosen)}px;` : ''
  const delay = view.title === text.restarting ? 0 : STATUS_DELAY_MS
  const lines = view.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
  return `<!doctype html>
<html lang="${view.locale}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Valkama</title>
<style>
:root { color-scheme: dark;${width} --sk-rail: clamp(200px, var(--sk-chosen, ${NAV_DEFAULT_WIDTH}px), max(200px, min(480px, 100vw - 500px))); }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; background: ${c.background}; }
body { overflow: hidden; color: ${c.text}; font: 400 14px/1.5 'Inter Variable', 'Segoe UI', system-ui, sans-serif; }
.sk { position: fixed; inset: 0; display: grid; grid-template-columns: var(--sk-rail) minmax(0, 1fr); }
.sk-rail { display: flex; flex-direction: column; min-height: 0; }
.sk-head { flex: none; height: 64px; padding: 17px 0 0 16px; color: ${c.onDark}; }
.sk-mark { display: block; fill: currentColor; }
.sk-list { display: flex; flex-direction: column; padding: 16px 12px; }
.sk-foot { margin-top: auto; padding: 0 12px 16px; }
.sk-entry { position: relative; display: block; height: 40px; }
.sk-entry + .sk-entry { margin-top: 2px; }
.sk-list .sk-work { margin-top: 24px; }
.sk-entry::before, .sk-entry::after { content: ''; position: absolute; border-radius: 5px; background: ${c.raised}; }
/* An entry's icon and the bar of its label stand where the shell's icon and the line of its words do: the words of a work action start at 44px, a module's at 46px. */
.sk-entry::before { left: 12px; top: 10px; width: 20px; height: 20px; }
.sk-entry::after { left: 44px; top: 14.3px; width: 112px; height: 10px; }
.sk-entry:nth-child(2)::after { width: 124px; }
.sk-work::after { left: 46px; width: 56px; }
.sk-foot .sk-entry::after { left: 46px; width: 72px; }
.sk-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; container: sk-main / inline-size; }
.sk-bar { flex: none; display: flex; gap: 16px; align-items: center; justify-content: space-between; height: 64px; padding: 12px 20px; }
.sk-title-row { display: flex; align-items: center; height: 26px; }
.sk-title { display: block; width: 80px; height: 12px; border-radius: 6px; background: ${c.raised}; }
.sk-scope { display: block; flex: none; width: 220px; height: 40px; border-radius: 8px; background: ${c.raised}; }
.sk-panel { display: grid; flex: 1 1 auto; place-items: center; min-height: 0; background: ${c.canvas}; border-top-left-radius: 12px; }
@media (width <= 760px) {
  :root { --sk-rail: 64px; }
  .sk-head { height: 24px; padding: 0; }
  .sk-mark { display: none; }
  .sk-list .sk-work { margin-top: 8px; }
  .sk-entry::before { left: 10px; }
  .sk-entry::after { display: none; }
}
@container sk-main (width <= 586px) {
  .sk-bar { flex-direction: column; gap: 8px; align-items: stretch; height: auto; padding: 8px 12px; }
  .sk-title-row { height: 23px; }
  .sk-scope { width: 100%; }
}
/* What the window waits for, said only once the wait is long enough to read it. */
.sk-status { display: grid; gap: 8px; justify-items: center; max-width: 440px; padding: 24px; text-align: center; animation: appear 160ms ease-out ${delay}ms both; }
@keyframes appear { from { opacity: 0; } }
h1 { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.35; display: flex; align-items: center; gap: 8px; }
h1::before { content: ''; flex: none; width: 12px; height: 12px; border-radius: 50%; border: 2px solid ${c.rule}; border-top-color: ${c.info}; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
p { margin: 0; color: ${c.muted}; }
@media (prefers-reduced-motion: reduce) {
  .sk-status { animation-duration: 1ms; }
  h1::before { animation: none; border-color: ${c.info}; }
}
</style>
</head>
<body>
<main class="sk" role="status" aria-busy="true" aria-label="${escapeHtml(text.status)}">
<div class="sk-rail" aria-hidden="true">
<div class="sk-head"><svg class="sk-mark" width="30" height="30" viewBox="0 0 96 96"><path d="${MARK_BODY}"/><path d="${MARK_ACCENT}"/></svg></div>
<div class="sk-list"><i class="sk-entry"></i><i class="sk-entry"></i><i class="sk-entry sk-work"></i></div>
<div class="sk-foot"><i class="sk-entry"></i></div>
</div>
<div class="sk-main">
<div class="sk-bar" aria-hidden="true"><div class="sk-title-row"><i class="sk-title"></i></div><i class="sk-scope"></i></div>
<div class="sk-panel"><div class="sk-status"><h1>${escapeHtml(view.title)}</h1>${lines}</div></div>
</div>
</main>
</body>
</html>`
}

function renderStartupPage(state) {
  const view = startupView(state)
  if (view.busy) return renderSkeletonPage(view, state.navWidth)
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
.brand { margin: 0 0 12px; font-size: 13px; font-weight: 600; color: ${c.muted}; letter-spacing: 0.02em; }
h1 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.35; display: flex; align-items: center; gap: 8px; }
h1::before { content: ''; flex: none; width: 8px; height: 8px; border-radius: 50%; background: ${c[view.tone]}; }
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
<main role="alert" aria-label="${escapeHtml(text.status)}">
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
