<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import InputText from 'primevue/inputtext'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const app = useAppStore()

const pageTitle = computed(() => {
  const titles: Record<string, string> = {
    '/overview': 'Overview',
    '/memory': 'Memory Browser',
    '/collections': 'Collections',
  }
  return titles[route.path] || 'Dashboard'
})
</script>

<template>
  <header style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1.5rem; background: var(--p-surface-0); border-bottom: 1px solid var(--p-surface-200);">
    <h1 style="margin: 0; font-size: 1.25rem; font-weight: 600;">{{ pageTitle }}</h1>
    <div style="display: flex; align-items: center; gap: 0.75rem;">
      <label style="font-size: 0.875rem; color: var(--p-text-muted-color);">Project:</label>
      <InputText v-model="app.currentProject" placeholder="project name" size="small" style="width: 12rem;" />
    </div>
  </header>
</template>
