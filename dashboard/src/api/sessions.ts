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

export async function fetchSessionActivity(sessionId: string): Promise<any[]> {
  try {
    const { data } = await client.get(`/api/session/${sessionId}`)
    // Extract tool call activity from session detail
    return data.toolCalls || data.activity || data.recentQueries?.map((q: string, i: number) => ({
      id: `q-${i}`,
      type: 'query',
      tool: 'search',
      query: q,
      timestamp: data.startedAt,
    })) || []
  } catch {
    return []
  }
}
