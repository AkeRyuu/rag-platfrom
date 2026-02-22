<script setup lang="ts">
import Tag from 'primevue/tag'
import type { MemoryStats } from '@/types/memory'

defineProps<{ stats: MemoryStats | null }>()

const typeColors: Record<string, string> = {
  decision: 'info',
  insight: 'success',
  context: 'secondary',
  todo: 'warn',
  conversation: 'contrast',
  note: 'secondary',
}
</script>

<template>
  <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
    <Tag severity="primary" :value="`Total: ${stats?.total ?? 0}`" />
    <template v-if="stats?.byType">
      <Tag
        v-for="(count, type) in stats.byType"
        :key="type"
        :severity="(typeColors[type] as any) || 'secondary'"
        :value="`${type}: ${count}`"
      />
    </template>
  </div>
</template>
