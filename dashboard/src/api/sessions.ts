import client from './client'
import type { SessionListItem, SessionDetail } from '@/types/session'

export async function fetchSessionsList(params: {
  limit?: number
  status?: 'all' | 'active' | 'ended'
}): Promise<SessionListItem[]> {
  const { data } = await client.get('/api/sessions', { params })
  return data.sessions ?? []
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetail> {
  const { data } = await client.get(`/api/session/${sessionId}`)
  return data
}

export async function endSession(sessionId: string): Promise<void> {
  await client.post(`/api/session/${sessionId}/end`)
}
