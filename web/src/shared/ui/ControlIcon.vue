<script setup lang="ts">
import { computed } from 'vue'

import type { IconName } from '@/shared/lib/uiSystem.ts'
import type { ControlIconName } from '@/shared/ui/choiceControls.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ name: ControlIconName }>()

const iconMap: Record<ControlIconName, IconName> = {
  'language': 'language',
  // A place to open in draws its kind: an editor, an agent's app, a terminal. Every one of
  // them drew the same monitor, so VS Code and Claude Desktop read alike in a list. A client
  // whose vendor allows a single-colour mark draws that mark (`cursor`); `editor` is any
  // other editor, which must never borrow one product's mark. VS Code draws it too.
  'vscode': 'editor',
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
