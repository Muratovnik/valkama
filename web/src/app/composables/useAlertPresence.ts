import { onMounted, watch } from 'vue'

import { useEventListener, useIntervalFn } from '@vueuse/core'

import { reportAlertPresence } from '@/shared/api/alertsApi.ts'

/** The listener forgets a page after 30 s, so two reports can go missing before it does. */
const HEARTBEAT_MS = 15_000

/**
 * Tell the listener what this page has in focus, so that an alert about what is
 * already on the screen stays quiet.
 *
 * It reports at once on every change and every 15 s while the page can be seen. A
 * page that goes hidden says so once, right away, because the listener would
 * otherwise go on believing it for 30 s, and then says nothing until it comes back.
 * One report travels at a time and the next carries the newest state, so a listener
 * that stops answering cannot use up the browser's connections to it. A report that
 * fails is not an error: no listener means no page to ask about.
 */
export function useAlertPresence(workItemId: () => string | null, hubOpen: () => boolean) {
  const pageId = crypto.randomUUID()
  let sending = false
  let again = false
  let saidHidden = false

  const visible = () => document.visibilityState === 'visible'

  function send(focused: boolean) {
    return reportAlertPresence({
      page_id: pageId,
      focused,
      work_item_id: workItemId(),
      hub_open: hubOpen(),
    }).catch(() => {})
  }

  function report() {
    if (sending) {
      again = true
      return
    }
    sending = true
    void send(document.hasFocus() && visible()).finally(() => {
      sending = false
      if (!again) return
      again = false
      if (visible()) report()
    })
  }

  /** The last word of a page going out of sight; it may not outlive this tick to wait its turn. */
  function sayHidden() {
    if (saidHidden) return
    saidHidden = true
    void send(false)
  }

  function onChange() {
    if (!visible()) {
      sayHidden()
      return
    }
    saidHidden = false
    report()
  }

  useIntervalFn(() => {
    if (visible()) report()
  }, HEARTBEAT_MS)
  useEventListener(window, 'focus', onChange)
  useEventListener(window, 'blur', onChange)
  useEventListener(document, 'visibilitychange', onChange)
  // A window can close without going hidden first, focused to the end.
  useEventListener(window, 'pagehide', sayHidden)
  watch([workItemId, hubOpen], onChange)
  onMounted(() => {
    if (visible()) report()
  })
}
