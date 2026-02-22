<script setup lang="ts">
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import type { IndexStatus } from '@/types/collections'

defineProps<{ status: IndexStatus | null }>()

function severityForStatus(s: string) {
  switch (s) {
    case 'completed': return 'success'
    case 'indexing': return 'info'
    case 'error': return 'danger'
    default: return 'secondary'
  }
}
</script>

<template>
  <div v-if="status" style="display: flex; align-items: center; gap: 0.75rem;">
    <Tag :severity="(severityForStatus(status.status) as any)" :value="status.status" />
    <ProgressBar
      v-if="status.status === 'indexing' && status.progress != null"
      :value="Math.round(status.progress * 100)"
      style="flex: 1; height: 1rem;"
    />
    <span v-if="status.indexedFiles != null" style="font-size: 0.8rem; color: var(--p-text-muted-color);">
      {{ status.indexedFiles }}/{{ status.totalFiles ?? '?' }} files
    </span>
  </div>
</template>
