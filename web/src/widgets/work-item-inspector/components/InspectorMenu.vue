<script setup lang="ts">
/**
 * «…» in a card's bar: what else a person can do with the item, beside Back and Close.
 *
 * It holds the pin, which keeps the item in the side panel's list of work whether or not
 * anyone works on it, until a person takes it off — the person's own list, like a favourite,
 * not a fact about the item. It stood in the identity line between the link and the date,
 * read there as one more fact of the item and pressed past on the way to the date. The link
 * stays beside the number: it is the number's twin, here as on a reference's hover card, and
 * what it did is said at the end of that line.
 *
 * Whether the item is pinned is the live-work frame's to say, since every pinned item is
 * one of its rows; until a frame has arrived there is nothing to say, and with nothing in it
 * there is no menu. Pinned, the entry carries a check, and choosing it takes the pin off. A
 * pin writes nothing to the item's history, and what came of it is said in the shell's
 * corner, as the rail's pin says it.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOpenNotice } from '@/features/session-open/openNotice.ts'

import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import type { MenuEntry } from '@/shared/ui/menuEntries.ts'
import VMenu from '@/shared/ui/VMenu.vue'

const props = defineProps<{ reference: string }>()

const { t } = useI18n()
const store = useLiveWorkStore()
const say = useOpenNotice()
const busy = ref(false)

const pinned = computed(() => store.pinned(props.reference))

async function pin(on: boolean) {
  if (busy.value || pinned.value === null || on === pinned.value) return
  busy.value = true
  try {
    await store.pin(props.reference, on)
    say(t(on ? 'liveWork.pinned' : 'liveWork.unpinned', { reference: props.reference }), 'done')
  } catch {
    say(t('liveWork.pinFailed'), 'refused')
  } finally {
    busy.value = false
  }
}

const entries = computed<MenuEntry[]>(() =>
  pinned.value === null
    ? []
    : [
        {
          kind: 'toggle',
          key: 'pin',
          label: t('liveWork.pin'),
          icon: 'pin',
          checked: pinned.value,
          disabled: busy.value,
          select: (on) => void pin(on),
        },
      ],
)
</script>

<template>
  <VMenu
    v-if="entries.length"
    :label="t('workItem.head.more')"
    :entries="entries"
  />
</template>
