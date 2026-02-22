export interface SessionListItem {
  id: string
  projectName: string
  status: 'active' | 'ended'
  initialContext?: string
  startedAt: string
  endedAt?: string
  duration?: number
}

export interface SessionDetail {
  id: string
  projectName: string
  status: 'active' | 'ended'
  initialContext?: string
  startedAt: string
  endedAt?: string
  currentFiles: string[]
  recentQueries: string[]
  toolsUsed: string[]
  activeFeatures: string[]
}
