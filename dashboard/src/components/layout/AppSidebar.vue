<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Menu from 'primevue/menu'
import Tag from 'primevue/tag'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const route = useRoute()
const app = useAppStore()

const items = computed(() => [
  {
    label: 'Overview',
    icon: 'pi pi-chart-bar',
    command: () => router.push('/overview'),
    class: route.path === '/overview' ? 'p-menuitem-active' : '',
  },
  {
    label: 'Memory',
    icon: 'pi pi-database',
    command: () => router.push('/memory'),
    class: route.path === '/memory' ? 'p-menuitem-active' : '',
  },
  {
    label: 'Collections',
    icon: 'pi pi-server',
    command: () => router.push('/collections'),
    class: route.path === '/collections' ? 'p-menuitem-active' : '',
  },
])
</script>

<template>
  <aside style="width: 15rem; background: var(--p-surface-0); border-right: 1px solid var(--p-surface-200); display: flex; flex-direction: column; padding: 1rem 0;">
    <div style="padding: 0 1rem 1rem; font-size: 1.25rem; font-weight: 700; color: var(--p-primary-color);">
      <i class="pi pi-bolt" style="margin-right: 0.5rem;" />RAG Dashboard
    </div>
    <Menu :model="items" style="border: none; width: 100%;" />
    <div style="margin-top: auto; padding: 1rem; text-align: center;">
      <Tag :severity="app.isConnected ? 'success' : 'danger'" :value="app.isConnected ? 'Connected' : 'Disconnected'" />
    </div>
  </aside>
</template>
