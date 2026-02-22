export type MemoryType = 'decision' | 'insight' | 'context' | 'todo' | 'conversation' | 'note'

export interface Memory {
  id: string
  content: string
  type: MemoryType
  tags: string[]
  relatedTo?: string
  score?: number
  createdAt: string
  validated?: boolean
  metadata?: Record<string, unknown>
}

export interface MemoryStats {
  total: number
  byType: Record<MemoryType, number>
}

export interface QuarantineMemory {
  id: string
  content: string
  type: MemoryType
  tags: string[]
  confidence?: number
  source?: string
  createdAt: string
}

export interface MergeCluster {
  count: number
  items: { id: string; content: string }[]
}
