<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'

import {
  Activity,
  Asterisk,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  ExternalLink,
  Filter,
  Info,
  Languages,
  LibraryBig,
  Menu,
  MessageSquare,
  Monitor,
  MousePointer2,
  Play,
  RadioTower,
  RefreshCw,
  Search,
  Settings,
  SquareKanban,
  SquareTerminal,
  TableProperties,
  Terminal,
  Wrench,
  X,
} from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    /** Manifest-owned icon key. Unknown keys intentionally get one generic glyph. */
    name: string
    size?: number
    strokeWidth?: number
  }>(),
  { size: 20, strokeWidth: 1.8 },
)

const genericIcons: Record<string, Component> = {
  'activity': Activity,
  'analytics': BarChart3,
  'bell': Bell,
  'board': SquareKanban,
  'check': Check,
  // The two agent clients get their own neutral glyph rather than the unknown
  // circle they were falling back to: a session row that says "codex" beside a
  // question mark reports a client the interface does not recognise.
  'claude': Asterisk,
  'codex': SquareTerminal,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'close': X,
  'client': Monitor,
  'copy': Copy,
  'cursor': MousePointer2,
  'database': Database,
  'external-link': ExternalLink,
  'filters': Filter,
  'info': Info,
  'improvements': Wrench,
  'layout-dashboard': SquareKanban,
  'chart-no-axes-combined': BarChart3,
  'key-round': LibraryBig,
  'settings-2': Settings,
  'language': Languages,
  'menu': Menu,
  'message-square': MessageSquare,
  'play': Play,
  'refresh': RefreshCw,
  'search': Search,
  'sessions': RadioTower,
  'skills': LibraryBig,
  'settings': Settings,
  'terminal': Terminal,
  'table': TableProperties,
}

const genericIcon = computed(() => genericIcons[props.name] ?? CircleHelp)
</script>

<template>
  <component
    :is="genericIcon"
    aria-hidden="true"
    :size="size"
    :stroke-width="strokeWidth"
  />
</template>
