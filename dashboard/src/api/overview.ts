import client from './client'
import type { ToolStats, KnowledgeGap, QualityMetrics, Session, PredictionStats } from '@/types/api'

export async function fetchToolAnalytics(days = 7): Promise<ToolStats> {
  const { data } = await client.get('/api/tool-analytics', { params: { days } })
  return data
}

export async function fetchKnowledgeGaps(limit = 20): Promise<KnowledgeGap[]> {
  const { data } = await client.get('/api/knowledge-gaps', { params: { limit } })
  return data.gaps ?? []
}

export async function fetchQualityMetrics(project: string): Promise<QualityMetrics> {
  const { data } = await client.get(`/api/quality/${project}`)
  return data
}

export async function fetchSessions(limit = 5): Promise<Session[]> {
  const { data } = await client.get('/api/sessions', { params: { limit } })
  return data.sessions ?? []
}

export async function fetchPredictionStats(): Promise<PredictionStats> {
  const { data } = await client.get('/api/predictions/stats')
  return data
}
