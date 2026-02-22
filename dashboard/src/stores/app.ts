import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import client from '@/api/client'

export const useAppStore = defineStore('app', () => {
  const currentProject = ref(localStorage.getItem('rag_project') || import.meta.env.VITE_DEFAULT_PROJECT || '')
  const apiKey = ref(localStorage.getItem('rag_api_key') || import.meta.env.VITE_API_KEY || '')
  const isConnected = ref(false)
  const healthError = ref('')

  watch(currentProject, (v) => localStorage.setItem('rag_project', v))
  watch(apiKey, (v) => localStorage.setItem('rag_api_key', v))

  async function checkHealth() {
    try {
      await client.get('/health')
      isConnected.value = true
      healthError.value = ''
    } catch (e: any) {
      isConnected.value = false
      healthError.value = e.message
    }
  }

  return { currentProject, apiKey, isConnected, healthError, checkHealth }
})
