import client from './client'
import type { GraphNode, GraphLink, BlastRadiusResult } from '@/types/graph'

export async function fetchDependencies(file: string, depth = 1): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  const { data } = await client.get('/api/graph/dependencies', { params: { file, depth } })
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  const seen = new Set<string>()

  // Normalize the response — API may return edges or nodes/links
  if (data.edges) {
    for (const edge of data.edges) {
      if (!seen.has(edge.source)) { nodes.push({ id: edge.source, name: edge.source.split('/').pop() || edge.source }); seen.add(edge.source) }
      if (!seen.has(edge.target)) { nodes.push({ id: edge.target, name: edge.target.split('/').pop() || edge.target }); seen.add(edge.target) }
      links.push({ source: edge.source, target: edge.target, type: edge.type })
    }
  } else if (data.nodes) {
    return { nodes: data.nodes, links: data.links ?? [] }
  }
  return { nodes, links }
}

export async function fetchDependents(file: string, depth = 1): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  const { data } = await client.get('/api/graph/dependents', { params: { file, depth } })
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  const seen = new Set<string>()

  if (data.edges) {
    for (const edge of data.edges) {
      if (!seen.has(edge.source)) { nodes.push({ id: edge.source, name: edge.source.split('/').pop() || edge.source }); seen.add(edge.source) }
      if (!seen.has(edge.target)) { nodes.push({ id: edge.target, name: edge.target.split('/').pop() || edge.target }); seen.add(edge.target) }
      links.push({ source: edge.source, target: edge.target, type: edge.type })
    }
  } else if (data.nodes) {
    return { nodes: data.nodes, links: data.links ?? [] }
  }
  return { nodes, links }
}

export async function fetchBlastRadius(file: string): Promise<BlastRadiusResult> {
  const { data } = await client.post('/api/graph/blast-radius', { file })
  return {
    affectedFiles: data.affectedFiles ?? [],
    totalAffected: data.totalAffected ?? data.affectedFiles?.length ?? 0,
  }
}
