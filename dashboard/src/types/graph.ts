export interface GraphNode {
  id: string
  name: string
  category?: number
  type?: string
  connectionCount?: number
}

export interface GraphLink {
  source: string
  target: string
  type?: string
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

export interface BlastRadiusResult {
  affectedFiles: { file: string; hop: number }[]
  totalAffected: number
}

export type LayoutMode = 'force' | 'circular' | 'tree'
export type EdgeTypeFilter = 'all' | 'imports' | 'extends' | 'implements'

export interface FileExport {
  name: string
  kind: string
  line?: number
}

export interface NodeInspectorData {
  file: string
  exports: FileExport[]
  dependencies: string[]
  dependents: string[]
}
