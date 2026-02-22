<script setup lang="ts">
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Select from 'primevue/select'
import ProgressSpinner from 'primevue/progressspinner'
import { useGraphStore } from '@/stores/graph'

const store = useGraphStore()

const depthOptions = [
  { label: '1 hop', value: 1 },
  { label: '2 hops', value: 2 },
  { label: '3 hops', value: 3 },
]

const modeOptions = [
  { label: 'Dependencies', value: 'deps' },
  { label: 'Dependents', value: 'dependents' },
  { label: 'Both', value: 'both' },
]
</script>

<template>
  <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
    <InputText
      v-model="store.searchFile"
      placeholder="File path (e.g. src/services/embedding.ts)"
      style="flex: 1; min-width: 16rem;"
      @keyup.enter="store.search()"
    />
    <Select v-model="store.depth" :options="depthOptions" optionLabel="label" optionValue="value" style="width: 8rem;" />
    <Select v-model="store.mode" :options="modeOptions" optionLabel="label" optionValue="value" style="width: 10rem;" />
    <Button label="Search" icon="pi pi-search" @click="store.search()" :loading="store.loading" />
  </div>
</template>
