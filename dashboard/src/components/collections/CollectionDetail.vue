<script setup lang="ts">
import Card from 'primevue/card'
import Button from 'primevue/button'
import Chip from 'primevue/chip'
import type { CollectionInfo } from '@/types/collections'

defineProps<{ info: CollectionInfo }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Card>
    <template #title>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span>{{ info.name }}</span>
        <Button icon="pi pi-times" text size="small" @click="emit('close')" />
      </div>
    </template>
    <template #content>
      <div style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.875rem;">
        <div><b>Vectors:</b> {{ info.vectorsCount?.toLocaleString() }}</div>
        <div><b>Points:</b> {{ info.pointsCount?.toLocaleString() ?? '—' }}</div>
        <div><b>Status:</b> {{ info.status }}</div>
        <div><b>Segments:</b> {{ info.segments ?? '—' }}</div>
        <div v-if="info.config?.params?.vectors">
          <b>Vector Config:</b>
          <div style="padding-left: 0.75rem; margin-top: 0.25rem;">
            Size: {{ info.config.params.vectors.size }}<br>
            Distance: {{ info.config.params.vectors.distance }}
          </div>
        </div>
        <div><b>Optimizer:</b> {{ info.optimizerStatus ?? 'ok' }}</div>
        <div v-if="info.indexedFields?.length">
          <b>Indexed Fields:</b>
          <div style="display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.25rem;">
            <Chip v-for="field in info.indexedFields" :key="field" :label="field" style="font-size: 0.75rem;" />
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>
