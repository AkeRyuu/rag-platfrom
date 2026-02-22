<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{ topTools?: { tool: string; count: number }[] }>()

const option = computed(() => {
  const tools = (props.topTools ?? []).slice(0, 10).reverse()

  return {
    tooltip: { trigger: 'axis' as const },
    grid: { left: 150, right: 20, top: 10, bottom: 20 },
    xAxis: { type: 'value' as const },
    yAxis: {
      type: 'category' as const,
      data: tools.map(t => t.tool),
      axisLabel: { width: 140, overflow: 'truncate' as const },
    },
    series: [{
      type: 'bar' as const,
      data: tools.map(t => t.count),
    }],
  }
})
</script>

<template>
  <VChart :option="option" style="height: 300px;" autoresize />
</template>
