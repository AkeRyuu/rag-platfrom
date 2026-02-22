import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchMemoryList, fetchMemoryStats, fetchQuarantine, deleteMemory as apiDelete, validateMemory as apiValidate, promoteMemory as apiPromote, recallMemories } from '@/api/memory'
import type { Memory, MemoryType, MemoryStats, QuarantineMemory } from '@/types/memory'

export const useMemoryStore = defineStore('memory', () => {
  const memories = ref<Memory[]>([])
  const stats = ref<MemoryStats | null>(null)
  const quarantine = ref<QuarantineMemory[]>([])
  const loading = ref(false)
  const filterType = ref<MemoryType | 'all'>('all')
  const filterTag = ref('')
  const searchQuery = ref('')

  async function loadMemories() {
    loading.value = true
    try {
      if (searchQuery.value) {
        memories.value = await recallMemories(
          searchQuery.value,
          filterType.value !== 'all' ? filterType.value : undefined,
          50
        )
      } else {
        memories.value = await fetchMemoryList({
          type: filterType.value,
          tag: filterTag.value || undefined,
          limit: 50,
        })
      }
    } finally {
      loading.value = false
    }
  }

  async function loadStats() {
    stats.value = await fetchMemoryStats()
  }

  async function loadQuarantine() {
    quarantine.value = await fetchQuarantine(20)
  }

  async function removeMemory(id: string) {
    await apiDelete(id)
    memories.value = memories.value.filter(m => m.id !== id)
  }

  async function validate(id: string, validated: boolean) {
    await apiValidate(id, validated)
    quarantine.value = quarantine.value.filter(m => m.id !== id)
  }

  async function promote(memoryId: string, reason: string) {
    await apiPromote(memoryId, reason)
    quarantine.value = quarantine.value.filter(m => m.id !== memoryId)
  }

  return {
    memories, stats, quarantine, loading,
    filterType, filterTag, searchQuery,
    loadMemories, loadStats, loadQuarantine,
    removeMemory, validate, promote,
  }
})
