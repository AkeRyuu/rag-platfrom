import client from './client'
import type { Memory, MemoryType, MemoryStats, QuarantineMemory } from '@/types/memory'

export async function fetchMemoryList(params: {
  type?: MemoryType | 'all'
  tag?: string
  limit?: number
}): Promise<Memory[]> {
  const { data } = await client.get('/api/memory/list', { params })
  return data.memories ?? []
}

export async function fetchMemoryStats(): Promise<MemoryStats> {
  const { data } = await client.get('/api/memory/stats')
  return data.stats
}

export async function fetchQuarantine(limit = 20): Promise<QuarantineMemory[]> {
  const { data } = await client.get('/api/memory/quarantine', { params: { limit } })
  return data.memories ?? []
}

export async function recallMemories(query: string, type?: string, limit = 10): Promise<Memory[]> {
  const { data } = await client.post('/api/memory/recall', { query, type, limit })
  return data.results ?? []
}

export async function deleteMemory(id: string): Promise<boolean> {
  const { data } = await client.delete(`/api/memory/${id}`)
  return data.success
}

export async function validateMemory(id: string, validated: boolean): Promise<void> {
  await client.patch(`/api/memory/${id}/validate`, { validated })
}

export async function promoteMemory(memoryId: string, reason: string): Promise<void> {
  await client.post('/api/memory/promote', { memoryId, reason })
}
