import client from './client'
import type { CollectionSummary, CollectionInfo, IndexStatus, AliasInfo } from '@/types/collections'

export async function fetchCollections(project?: string): Promise<CollectionSummary[]> {
  const { data } = await client.get('/api/collections', { params: project ? { project } : {} })
  return data.collections ?? []
}

export async function fetchCollectionInfo(name: string): Promise<CollectionInfo> {
  const { data } = await client.get(`/api/collections/${name}/info`)
  return data
}

export async function fetchIndexStatus(collection: string): Promise<IndexStatus> {
  const { data } = await client.get(`/api/index/status/${collection}`)
  return data
}

export async function fetchAliases(): Promise<AliasInfo[]> {
  const { data } = await client.get('/api/aliases')
  return data.aliases ?? []
}
