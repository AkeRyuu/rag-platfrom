<script setup lang="ts">
import { computed } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useGraphStore } from '@/stores/graph'

const store = useGraphStore()

const groupedByHop = computed(() => {
  if (!store.blastRadius) return []
  const map = new Map<number, string[]>()
  for (const f of store.blastRadius.affectedFiles) {
    const list = map.get(f.hop) || []
    list.push(f.file)
    map.set(f.hop, list)
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
})
</script>

<template>
  <Card v-if="store.searchFile">
    <template #title>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span>Blast Radius</span>
        <Button
          label="Analyze"
          icon="pi pi-bolt"
          size="small"
          severity="warn"
          :loading="store.blastLoading"
          @click="store.analyzeBlastRadius()"
        />
      </div>
    </template>
    <template #content>
      <div v-if="!store.blastRadius" style="color: var(--p-text-muted-color); font-size: 0.875rem;">
        Click Analyze to see how many files would be affected by changes.
      </div>
      <div v-else style="display: flex; flex-direction: column; gap: 0.75rem;">
        <div style="font-size: 0.875rem;">
          <b>{{ store.blastRadius.totalAffected }}</b> files affected
        </div>
        <div v-for="[hop, files] in groupedByHop" :key="hop">
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
            <Tag :value="`Hop ${hop}`" :severity="hop === 1 ? 'warn' : 'secondary'" />
            <span style="font-size: 0.8rem; color: var(--p-text-muted-color);">{{ files.length }} files</span>
          </div>
          <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.8rem;">
            <li v-for="f in files" :key="f">{{ f }}</li>
          </ul>
        </div>
      </div>
    </template>
  </Card>
</template>
