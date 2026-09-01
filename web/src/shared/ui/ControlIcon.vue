<script setup lang="ts">
import { computed } from 'vue'

import type { IconName } from '@/shared/lib/uiSystem.ts'
import type { ControlIconName } from '@/shared/ui/choiceControls.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ name: ControlIconName }>()

const iconMap: Record<ControlIconName, IconName> = {
  language: 'language',
  vscode: 'client',
  terminal: 'terminal',
  command: 'settings',
  cursor: 'cursor',
  codex: 'client',
  claude: 'client',
  client: 'sessions',
  memory: 'database',
  board: 'board',
  skills: 'skills',
  search: 'search',
  check: 'check',
  chevron: 'chevron-down',
}

const icon = computed(() => iconMap[props.name])
</script>

<template><VIcon :name="icon" /></template>
