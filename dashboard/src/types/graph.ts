export interface GraphNode {
  id: string
  name: string
  category?: number
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
