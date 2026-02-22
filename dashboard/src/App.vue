<script setup lang="ts">
import { onMounted } from 'vue'
import Toast from 'primevue/toast'
import AppLayout from '@/components/layout/AppLayout.vue'
import { useAppStore } from '@/stores/app'
import { usePolling } from '@/composables/usePolling'

const app = useAppStore()
const { start } = usePolling(() => app.checkHealth(), 30000)

onMounted(start)
</script>

<template>
  <Toast />
  <AppLayout>
    <router-view />
  </AppLayout>
</template>
