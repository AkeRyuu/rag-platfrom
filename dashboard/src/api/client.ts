import axios from 'axios'

const client = axios.create({
  baseURL: localStorage.getItem('rag_api_url') || import.meta.env.VITE_RAG_API_URL || '',
  timeout: 15000,
})

client.interceptors.request.use((config) => {
  const apiKey = localStorage.getItem('rag_api_key') || import.meta.env.VITE_API_KEY
  const project = localStorage.getItem('rag_project') || import.meta.env.VITE_DEFAULT_PROJECT

  if (apiKey) {
    config.headers['X-API-Key'] = apiKey
  }
  if (project) {
    config.headers['X-Project-Name'] = project
  }

  return config
})

// Global error interceptor — dispatches toast events for 401/5xx
client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    if (status === 401 || status === 403) {
      window.dispatchEvent(new CustomEvent('rag-api-error', {
        detail: { severity: 'error', summary: 'Authentication Error', detail: 'Check your API key in Settings' },
      }))
    } else if (status && status >= 500) {
      window.dispatchEvent(new CustomEvent('rag-api-error', {
        detail: { severity: 'error', summary: 'Server Error', detail: error.response?.data?.error || `HTTP ${status}` },
      }))
    }
    return Promise.reject(error)
  }
)

export default client
