import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  fetchMemoryList, fetchMemoryStats, fetchQuarantine, fetchUnvalidated,
  deleteMemory as apiDelete, validateMemory as apiValidate, promoteMemory as apiPromote,
  recallMemories, createMemoryApi, mergeMemoriesApi, bulkDeleteByTypeApi,
} from '@/api/memory'
import type { Memory, MemoryType, MemoryStats, QuarantineMemory, MergeCluster } from '@/types/memory'

export const useMemoryStore = defineStore('memory', () => {
  const memories = ref<Memory[]>([])
  const stats = ref<MemoryStats | null>(null)
  const quarantine = ref<QuarantineMemory[]>([])
  const unvalidated = ref<QuarantineMemory[]>([])
  const loading = ref(false)
  const error = ref('')
  const filterType = ref<MemoryType | 'all'>('all')
  const filterTag = ref('')
  const searchQuery = ref('')

  // Pagination
  const page = ref(0)
  const pageSize = ref(20)
  const total = ref(0)

  // Merge preview
  const mergePreview = ref<MergeCluster[]>([])

  async function loadMemories() {
    loading.value = true
    error.value = ''
    try {
      if (searchQuery.value) {
        const results = await recallMemories(
          searchQuery.value,
          filterType.value !== 'all' ? filterType.value : undefined,
          pageSize.value
        )
        memories.value = results
        total.value = results.length
      } else {
        const result = await fetchMemoryList({
          type: filterType.value,
          tag: filterTag.value || undefined,
          limit: pageSize.value,
          offset: page.value * pageSize.value,
        })
        memories.value = result.memories
        total.value = result.total
      }
    } catch (e: any) {
      error.value = e.message || 'Failed to load memories'
    } finally {
      loading.value = false
    }
  }

  async function loadStats() {
    try {
      stats.value = await fetchMemoryStats()
    } catch { /* ignore */ }
  }

  async function loadQuarantine() {
    try {
      quarantine.value = await fetchQuarantine(20)
    } catch { /* ignore */ }
  }

  async function loadUnvalidated() {
    try {
      unvalidated.value = await fetchUnvalidated(20)
    } catch { /* ignore */ }
  }

  async function removeMemory(id: string) {
    await apiDelete(id)
    memories.value = memories.value.filter(m => m.id !== id)
    total.value = Math.max(0, total.value - 1)
  }

  async function validate(id: string, validated: boolean) {
    await apiValidate(id, validated)
    quarantine.value = quarantine.value.filter(m => m.id !== id)
    unvalidated.value = unvalidated.value.filter(m => m.id !== id)
  }

  async function promote(memoryId: string, reason: string) {
    await apiPromote(memoryId, reason)
    quarantine.value = quarantine.value.filter(m => m.id !== memoryId)
  }

  async function createMemory(params: { type: MemoryType; content: string; relatedTo?: string; tags: string[] }) {
    await createMemoryApi(params)
    await loadMemories()
  }

  async function loadMergePreview() {
    mergePreview.value = await mergeMemoriesApi(true)
  }

  async function executeMerge() {
    await mergeMemoriesApi(false)
    mergePreview.value = []
  }

  async function bulkDeleteByType(type: MemoryType) {
    await bulkDeleteByTypeApi(type)
  }

  return {
    memories, stats, quarantine, unvalidated, loading, error,
    filterType, filterTag, searchQuery,
    page, pageSize, total, mergePreview,
    loadMemories, loadStats, loadQuarantine, loadUnvalidated,
    removeMemory, validate, promote,
    createMemory, loadMergePreview, executeMerge, bulkDeleteByType,
  }
})
