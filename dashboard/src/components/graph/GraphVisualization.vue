<script setup lang="ts">
import { computed, ref } from 'vue'
import VChart from 'vue-echarts'
import Button from 'primevue/button'
import { useGraphStore } from '@/stores/graph'

const store = useGraphStore()
const chartRef = ref<InstanceType<typeof VChart> | null>(null)

const EDGE_COLORS: Record<string, string> = {
  imports: '#3B82F6',
  extends: '#22C55E',
  implements: '#F97316',
}

const filteredLinks = computed(() => {
  if (store.edgeTypeFilter === 'all') return store.links
  return store.links.filter(l => (l.type || 'imports') === store.edgeTypeFilter)
})

const filteredNodeIds = computed(() => {
  const ids = new Set<string>()
  for (const l of filteredLinks.value) {
    ids.add(l.source)
    ids.add(l.target)
  }
  return ids
})

const filteredNodes = computed(() => {
  if (store.edgeTypeFilter === 'all' && !store.filePatternFilter) return store.nodes
  return store.nodes.filter(n => {
    if (store.edgeTypeFilter !== 'all' && !filteredNodeIds.value.has(n.id)) return false
    if (store.filePatternFilter && !n.id.includes(store.filePatternFilter)) return false
    return true
  })
})

const layoutConfig = computed(() => {
  switch (store.layoutMode) {
    case 'circular':
      return { layout: 'circular', circular: { rotateLabel: true }, force: undefined }
    case 'tree':
      return { layout: 'force', force: { repulsion: 400, edgeLength: [100, 200], gravity: 0.05 } }
    default:
      return { layout: 'force', force: { repulsion: 250, edgeLength: [80, 180], gravity: 0.08 } }
  }
})

const categories = [
  { name: 'imports', itemStyle: { color: '#3B82F6' } },
  { name: 'extends', itemStyle: { color: '#22C55E' } },
  { name: 'implements', itemStyle: { color: '#F97316' } },
  { name: 'selected', itemStyle: { color: '#EF4444' } },
]

const chartOption = computed(() => ({
  tooltip: {
    formatter: (params: any) => {
      if (params.dataType === 'edge') {
        return `<b>${params.data.type || 'imports'}</b><br/>${params.data.source} → ${params.data.target}`
      }
      return `<b>${params.data.id}</b><br/>Connections: ${params.data.connectionCount || 0}`
    },
  },
  legend: {
    data: ['imports', 'extends', 'implements'],
    bottom: 0,
    textStyle: { fontSize: 11 },
  },
  animationDurationUpdate: 400,
  series: [
    {
      type: 'graph',
      ...layoutConfig.value,
      roam: true,
      draggable: true,
      categories,
      label: {
        show: true,
        fontSize: 10,
        position: 'right',
      },
      edgeLabel: {
        show: store.links.length < 60,
        fontSize: 9,
        formatter: (params: any) => params.data.type || '',
      },
      data: filteredNodes.value.map(n => {
        const isSelected = n.id === store.selectedNode
        const isSearch = n.id === store.searchFile
        const baseSize = Math.min(8 + (n.connectionCount || 1) * 3, 40)
        return {
          name: n.name,
          id: n.id,
          connectionCount: n.connectionCount || 0,
          symbolSize: isSearch ? 35 : isSelected ? 30 : baseSize,
          category: isSearch || isSelected ? 3 : 0,
          itemStyle: isSearch
            ? { color: '#EF4444', borderColor: '#fff', borderWidth: 2 }
            : isSelected
              ? { color: '#F59E0B', borderColor: '#fff', borderWidth: 2 }
              : { color: '#64748B' },
        }
      }),
      links: filteredLinks.value.map(l => ({
        source: l.source,
        target: l.target,
        type: l.type || 'imports',
        lineStyle: {
          color: EDGE_COLORS[l.type || 'imports'] || '#94A3B8',
          width: 1.5,
          curveness: 0.15,
        },
      })),
      emphasis: {
        focus: 'adjacency',
        lineStyle: { width: 3 },
      },
    },
  ],
}))

function onChartClick(params: any) {
  if (params.dataType === 'node' && params.data?.id) {
    store.selectNode(params.data.id)
  }
}

function fitToScreen() {
  chartRef.value?.chart?.dispatchAction({ type: 'restore' })
}
</script>

<template>
  <div style="background: var(--p-surface-0); border: 1px solid var(--p-surface-200); border-radius: 8px; padding: 0.5rem; position: relative;">
    <div style="position: absolute; top: 0.5rem; right: 0.5rem; z-index: 10; display: flex; gap: 0.25rem;">
      <Button icon="pi pi-arrows-alt" text size="small" v-tooltip="'Fit to screen'" @click="fitToScreen" />
    </div>
    <VChart
      ref="chartRef"
      :option="chartOption"
      autoresize
      style="height: 600px; width: 100%;"
      @click="onChartClick"
    />
  </div>
</template>
