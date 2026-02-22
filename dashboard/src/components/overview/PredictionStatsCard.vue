<script setup lang="ts">
import { computed } from 'vue'
import Card from 'primevue/card'
import Knob from 'primevue/knob'
import VChart from 'vue-echarts'
import type { PredictionStats } from '@/types/api'

const props = defineProps<{ stats?: PredictionStats | null }>()

const hitPct = computed(() => props.stats ? Math.round(props.stats.hitRate * 100) : 0)

const strategyChart = computed(() => {
  if (!props.stats?.strategies) return null
  const entries = Object.entries(props.stats.strategies)
  if (entries.length === 0) return null
  return {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: entries.map(e => e[0]) },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: entries.map(e => e[1]), itemStyle: { color: '#8B5CF6' } }],
  }
})
</script>

<template>
  <Card>
    <template #title>Prediction Stats</template>
    <template #content>
      <div v-if="!stats" style="color: var(--p-text-muted-color); font-size: 0.875rem;">No data</div>
      <div v-else style="display: flex; flex-direction: column; gap: 0.75rem;">
        <div style="display: flex; align-items: center; gap: 1.5rem;">
          <div style="text-align: center;">
            <Knob :modelValue="hitPct" :size="80" readonly valueColor="#8B5CF6" />
            <div style="font-size: 0.75rem; color: var(--p-text-muted-color); margin-top: 0.25rem;">Hit Rate</div>
          </div>
          <div style="font-size: 0.875rem;">
            <div><b>{{ stats.totalPredictions.toLocaleString() }}</b> predictions</div>
          </div>
        </div>
        <VChart v-if="strategyChart" :option="strategyChart" autoresize style="height: 150px; width: 100%;" />
      </div>
    </template>
  </Card>
</template>
