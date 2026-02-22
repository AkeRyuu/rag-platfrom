<script setup lang="ts">
import Message from 'primevue/message'
import Button from 'primevue/button'
import GraphSearch from '@/components/graph/GraphSearch.vue'
import GraphVisualization from '@/components/graph/GraphVisualization.vue'
import BlastRadiusPanel from '@/components/graph/BlastRadiusPanel.vue'
import { useGraphStore } from '@/stores/graph'
import { useProjectWatch } from '@/composables/useProjectWatch'

const store = useGraphStore()

useProjectWatch(() => { store.nodes = []; store.links = [] })
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 1rem;">
    <GraphSearch />

    <Message v-if="store.error" severity="error" :closable="false">{{ store.error }}</Message>

    <GraphVisualization v-if="store.nodes.length > 0" />

    <div v-if="store.nodes.length === 0 && !store.loading" style="padding: 3rem; text-align: center; color: var(--p-text-muted-color);">
      Enter a file path and search to explore the dependency graph.
    </div>

    <BlastRadiusPanel />
  </div>
</template>
