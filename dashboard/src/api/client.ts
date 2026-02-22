import axios from 'axios'

const client = axios.create({
  baseURL: import.meta.env.VITE_RAG_API_URL || '',
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

export default client
