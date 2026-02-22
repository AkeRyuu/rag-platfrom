import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchSessionsList, fetchSessionDetail, endSession as endSessionApi } from '@/api/sessions'
import type { SessionListItem, SessionDetail } from '@/types/session'

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref<SessionListItem[]>([])
  const selectedSession = ref<SessionDetail | null>(null)
  const loading = ref(false)
  const error = ref('')
  const statusFilter = ref<'all' | 'active' | 'ended'>('all')

  async function loadSessions() {
    loading.value = true
    error.value = ''
    try {
      sessions.value = await fetchSessionsList({ limit: 50, status: statusFilter.value })
    } catch (e: any) {
      error.value = e.message || 'Failed to load sessions'
    } finally {
      loading.value = false
    }
  }

  async function selectSession(id: string) {
    try {
      selectedSession.value = await fetchSessionDetail(id)
    } catch (e: any) {
      error.value = e.message || 'Failed to load session detail'
    }
  }

  async function endSession(id: string) {
    await endSessionApi(id)
    if (selectedSession.value?.id === id) {
      selectedSession.value = { ...selectedSession.value, status: 'ended' }
    }
    await loadSessions()
  }

  function clearSelection() {
    selectedSession.value = null
  }

  return {
    sessions, selectedSession, loading, error, statusFilter,
    loadSessions, selectSession, endSession, clearSelection,
  }
})
