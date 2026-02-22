<script setup lang="ts">
import Card from 'primevue/card'
import type { QualityMetrics } from '@/types/api'

defineProps<{ metrics: QualityMetrics | null }>()
</script>

<template>
  <Card>
    <template #title>Quality Metrics</template>
    <template #content>
      <div v-if="!metrics" style="color: var(--p-text-muted-color);">No data available</div>
      <div v-else style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div>
          <h4 style="margin: 0 0 0.5rem;">Search</h4>
          <div style="display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem;">
            <span>Feedback: <b>{{ metrics.search.totalFeedback }}</b></span>
            <span>Helpful: <b>{{ Math.round(metrics.search.helpfulRate * 100) }}%</b></span>
            <span>Avg Results: <b>{{ metrics.search.avgResultCount?.toFixed(1) }}</b></span>
          </div>
        </div>
        <div>
          <h4 style="margin: 0 0 0.5rem;">Memory</h4>
          <div style="display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem;">
            <span>Feedback: <b>{{ metrics.memory.totalFeedback }}</b></span>
            <span>Accurate: <b>{{ Math.round(metrics.memory.accurateRate * 100) }}%</b></span>
            <span>Outdated: <b>{{ Math.round(metrics.memory.outdatedRate * 100) }}%</b></span>
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>
