import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchCollections, fetchCollectionInfo, fetchAliases } from '@/api/collections'
import type { CollectionSummary, CollectionInfo, AliasInfo } from '@/types/collections'

export const useCollectionsStore = defineStore('collections', () => {
  const collections = ref<CollectionSummary[]>([])
  const selectedCollection = ref<CollectionInfo | null>(null)
  const aliases = ref<AliasInfo[]>([])
  const loading = ref(false)

  async function loadCollections(project?: string) {
    loading.value = true
    try {
      const [cols, als] = await Promise.all([
        fetchCollections(project),
        fetchAliases(),
      ])
      collections.value = cols
      aliases.value = als
    } finally {
      loading.value = false
    }
  }

  async function selectCollection(name: string) {
    selectedCollection.value = await fetchCollectionInfo(name)
  }

  function clearSelection() {
    selectedCollection.value = null
  }

  return { collections, selectedCollection, aliases, loading, loadCollections, selectCollection, clearSelection }
})
