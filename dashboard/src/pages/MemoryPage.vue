<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import MemoryStatsVue from '@/components/memory/MemoryStats.vue'
import MemoryFilters from '@/components/memory/MemoryFilters.vue'
import MemoryCardGrid from '@/components/memory/MemoryCardGrid.vue'
import QuarantineQueue from '@/components/memory/QuarantineQueue.vue'
import { useMemoryStore } from '@/stores/memory'
import { useToast } from '@/composables/useToast'

const store = useMemoryStore()
const toast = useToast()
const activeTab = ref('memories')

const quarantineLabel = computed(() => `Quarantine (${store.quarantine.length})`)

onMounted(async () => {
  await Promise.all([store.loadMemories(), store.loadStats(), store.loadQuarantine()])
})

async function handleDelete(id: string) {
  try {
    await store.removeMemory(id)
    toast.success('Memory deleted')
  } catch {
    toast.error('Failed to delete memory')
  }
}

async function handleValidate(id: string, validated: boolean) {
  try {
    await store.validate(id, validated)
    toast.success(validated ? 'Memory validated' : 'Memory rejected')
  } catch {
    toast.error('Validation failed')
  }
}

async function handlePromote(id: string, reason: string) {
  try {
    await store.promote(id, reason)
    toast.success('Memory promoted to durable storage')
  } catch {
    toast.error('Promotion failed')
  }
}
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 1rem;">
    <MemoryStatsVue :stats="store.stats" />

    <Tabs v-model:value="activeTab">
      <TabList>
        <Tab value="memories">All Memories</Tab>
        <Tab value="quarantine">{{ quarantineLabel }}</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="memories">
          <div style="display: flex; flex-direction: column; gap: 1rem; padding-top: 0.5rem;">
            <MemoryFilters />
            <MemoryCardGrid :memories="store.memories" :loading="store.loading" @delete="handleDelete" />
          </div>
        </TabPanel>
        <TabPanel value="quarantine">
          <QuarantineQueue
            :memories="store.quarantine"
            @validate="handleValidate"
            @promote="handlePromote"
          />
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>
