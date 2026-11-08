<script setup lang="ts">
import { computed } from 'vue'

import type { IconName } from '@/shared/lib/uiSystem.ts'
import type { ControlIconName } from '@/shared/ui/choiceControls.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ name: ControlIconName }>()

const iconMap: Record<ControlIconName, IconName> = {
  'language': 'language',
  // A place to open in draws its product's mark where there is one (VS Code, Cursor, Codex)
  // and its kind where there is not: an editor, an agent's app, a terminal. `editor` is any
  // other editor, which must never borrow one product's mark.
  'vscode': 'vscode',
  'editor': 'editor',
  'terminal': 'terminal',
  'command': 'settings',
  'cursor': 'cursor',
  'codex': 'codex',
  'claude': 'claude',
  'client': 'sessions',
  // Back to where a thing last was, and a choice that does nothing.
  'last-place': 'refresh',
  'off': 'waiting',
  'memory': 'database',
  'board': 'board',
  'skills': 'skills',
  'search': 'search',
  'check': 'check',
  'chevron': 'chevron-down',
}

const icon = computed(() => iconMap[props.name])
</script>

<template><VIcon :name="icon" /></template>
