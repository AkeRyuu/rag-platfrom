<script setup lang="ts">
import { computed } from 'vue'
import Card from 'primevue/card'
import Chip from 'primevue/chip'
import VChart from 'vue-echarts'
import type { DeveloperProfile } from '@/types/api'

const props = defineProps<{ profile?: DeveloperProfile | null }>()

const peakHoursChart = computed(() => {
  if (!props.profile?.peakHours) return null
  const hours = Object.entries(props.profile.peakHours).sort((a, b) => Number(a[0]) - Number(b[0]))
  if (hours.length === 0) return null
  return {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: hours.map(h => `${h[0]}h`) },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'line',
      data: hours.map(h => h[1]),
      smooth: true,
      areaStyle: { opacity: 0.3 },
      itemStyle: { color: '#10B981' },
    }],
    grid: { top: 10, bottom: 25, left: 30, right: 10 },
  }
})
</script>

<template>
  <Card>
    <template #title>Developer Profile</template>
    <template #content>
      <div v-if="!profile" style="color: var(--p-text-muted-color); font-size: 0.875rem;">No data</div>
      <div v-else style="display: flex; flex-direction: column; gap: 0.75rem;">
        <VChart v-if="peakHoursChart" :option="peakHoursChart" autoresize style="height: 100px; width: 100%;" />

        <div v-if="profile.frequentFiles?.length" style="font-size: 0.875rem;">
          <b>Top Files:</b>
          <div v-for="f in profile.frequentFiles.slice(0, 5)" :key="f.file" style="display: flex; justify-content: space-between; padding: 0.125rem 0;">
            <span style="font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ f.file }}</span>
            <span style="font-size: 0.75rem; color: var(--p-text-muted-color); flex-shrink: 0; margin-left: 0.5rem;">{{ f.count }}</span>
          </div>
        </div>

        <div v-if="profile.preferredTools?.length">
          <b style="font-size: 0.875rem;">Preferred Tools:</b>
          <div style="display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.25rem;">
            <Chip v-for="t in profile.preferredTools.slice(0, 8)" :key="t" :label="t" style="font-size: 0.75rem;" />
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>
