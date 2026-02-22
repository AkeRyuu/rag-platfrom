<script setup lang="ts">
import { onMounted } from 'vue'
import ProgressSpinner from 'primevue/progressspinner'
import CollectionsTable from '@/components/collections/CollectionsTable.vue'
import CollectionDetail from '@/components/collections/CollectionDetail.vue'
import { useCollectionsStore } from '@/stores/collections'
import { useAppStore } from '@/stores/app'

const store = useCollectionsStore()
const app = useAppStore()

onMounted(() => store.loadCollections(app.currentProject || undefined))

function handleSelect(name: string) {
  store.selectCollection(name)
}
</script>

<template>
  <div v-if="store.loading" style="display: flex; justify-content: center; padding: 3rem;">
    <ProgressSpinner />
  </div>
  <div v-else style="display: flex; gap: 1rem;">
    <div style="flex: 1; min-width: 0;">
      <CollectionsTable
        :collections="store.collections"
        :aliases="store.aliases"
        @select="handleSelect"
      />
    </div>
    <div v-if="store.selectedCollection" style="width: 24rem; flex-shrink: 0;">
      <CollectionDetail
        :info="store.selectedCollection"
        @close="store.clearSelection()"
      />
    </div>
  </div>
</template>
