<script setup lang="ts">
import { computed } from 'vue'

import { BaseEdge } from '@vue-flow/core'
import type { EdgeProps } from '@vue-flow/core'
import type { ElkPoint } from 'elkjs/lib/elk-api'

import type { PlanningEdge } from '@/shared/api/planningModel.ts'

const props =
  defineProps<
    Pick<EdgeProps<{ kind: PlanningEdge['kind']; points: ElkPoint[] }>, 'id' | 'data' | 'markerEnd'>
  >()
const path = computed(
  () =>
    props.data?.points
      .map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`)
      .join(' ') ?? '',
)
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path"
    :marker-end="markerEnd"
  />
</template>
