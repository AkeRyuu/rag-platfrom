<script setup lang="ts">
import { computed } from 'vue'
import Card from 'primevue/card'
import Knob from 'primevue/knob'
import type { CacheStats } from '@/types/api'

const props = defineProps<{ stats?: CacheStats | null }>()

const hitPct = computed(() => props.stats ? Math.round(props.stats.hitRate * 100) : 0)
</script>

<template>
  <Card>
    <template #title>Cache Stats</template>
    <template #content>
      <div v-if="!stats" style="color: var(--p-text-muted-color); font-size: 0.875rem;">No data</div>
      <div v-else style="display: flex; align-items: center; gap: 1.5rem;">
        <div style="text-align: center;">
          <Knob :modelValue="hitPct" :size="80" readonly valueColor="#F59E0B" />
          <div style="font-size: 0.75rem; color: var(--p-text-muted-color); margin-top: 0.25rem;">Hit Rate</div>
        </div>
        <div style="font-size: 0.875rem; display: flex; flex-direction: column; gap: 0.25rem;">
          <div><b>{{ stats.totalRequests.toLocaleString() }}</b> requests</div>
          <div><b>{{ stats.totalHits.toLocaleString() }}</b> hits</div>
          <div v-if="stats.memoryUsageMb != null"><b>{{ stats.memoryUsageMb.toFixed(1) }}</b> MB</div>
        </div>
      </div>
    </template>
  </Card>
</template>
