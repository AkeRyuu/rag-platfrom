<script setup lang="ts">
import { computed } from 'vue'
import Card from 'primevue/card'
import Knob from 'primevue/knob'
import type { FeedbackStats } from '@/types/api'

const props = defineProps<{ stats?: FeedbackStats | null }>()

const helpfulPct = computed(() => props.stats ? Math.round(props.stats.helpfulRate * 100) : 0)
</script>

<template>
  <Card>
    <template #title>Feedback Trends</template>
    <template #content>
      <div v-if="!stats" style="color: var(--p-text-muted-color); font-size: 0.875rem;">No data</div>
      <div v-else style="display: flex; align-items: center; gap: 1.5rem;">
        <div style="text-align: center;">
          <Knob :modelValue="helpfulPct" :size="80" readonly valueColor="#10B981" />
          <div style="font-size: 0.75rem; color: var(--p-text-muted-color); margin-top: 0.25rem;">Helpful</div>
        </div>
        <div style="font-size: 0.875rem; display: flex; flex-direction: column; gap: 0.25rem;">
          <div><b>{{ stats.totalFeedback }}</b> total feedback</div>
          <div><b>{{ stats.searchFeedback }}</b> search</div>
          <div><b>{{ stats.memoryFeedback }}</b> memory</div>
        </div>
      </div>
    </template>
  </Card>
</template>
