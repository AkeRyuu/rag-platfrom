<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { useGraphStore } from '@/stores/graph'

const store = useGraphStore()

const chartOption = computed(() => ({
  tooltip: {},
  animationDurationUpdate: 500,
  series: [
    {
      type: 'graph',
      layout: 'force',
      roam: true,
      draggable: true,
      label: {
        show: true,
        fontSize: 10,
      },
      force: {
        repulsion: 200,
        edgeLength: [80, 160],
        gravity: 0.1,
      },
      data: store.nodes.map(n => ({
        name: n.name,
        id: n.id,
        symbolSize: n.id === store.searchFile ? 30 : 18,
        itemStyle: n.id === store.searchFile
          ? { color: '#3B82F6' }
          : { color: '#64748B' },
      })),
      links: store.links.map(l => ({
        source: l.source,
        target: l.target,
      })),
      lineStyle: {
        color: '#94A3B8',
        width: 1.5,
        curveness: 0.1,
      },
      emphasis: {
        focus: 'adjacency',
        lineStyle: { width: 3 },
      },
    },
  ],
}))
</script>

<template>
  <div style="background: var(--p-surface-0); border: 1px solid var(--p-surface-200); border-radius: 8px; padding: 0.5rem;">
    <VChart :option="chartOption" autoresize style="height: 500px; width: 100%;" />
  </div>
</template>
