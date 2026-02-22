export interface CollectionSummary {
  name: string
  vectorsCount: number
  status: string
}

export interface CollectionInfo {
  name: string
  vectorsCount: number
  status: string
  config?: {
    params?: {
      vectors?: {
        size?: number
        distance?: string
      }
    }
  }
  segments?: number
  indexedFields?: string[]
  optimizerStatus?: string
  pointsCount?: number
}

export interface IndexStatus {
  status: 'idle' | 'indexing' | 'completed' | 'error'
  progress?: number
  indexedFiles?: number
  totalFiles?: number
  errors?: string[]
  vectorCount?: number
  collectionStatus?: string
}

export interface AliasInfo {
  aliasName: string
  collectionName: string
}
