<script setup lang="ts">
import AppSidebar from './AppSidebar.vue'
import AppTopbar from './AppTopbar.vue'
</script>

<template>
  <div style="display: flex; min-height: 100vh;">
    <AppSidebar />
    <div style="flex: 1; display: flex; flex-direction: column;">
      <AppTopbar />
      <main style="flex: 1; padding: 1.5rem; background: var(--p-surface-50);">
        <slot />
      </main>
    </div>
  </div>
</template>
