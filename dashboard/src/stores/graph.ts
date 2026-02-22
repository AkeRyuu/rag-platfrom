import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchDependencies, fetchDependents, fetchBlastRadius } from '@/api/graph'
import type { GraphNode, GraphLink, BlastRadiusResult } from '@/types/graph'

export const useGraphStore = defineStore('graph', () => {
  const nodes = ref<GraphNode[]>([])
  const links = ref<GraphLink[]>([])
  const loading = ref(false)
  const error = ref('')
  const searchFile = ref('')
  const depth = ref(1)
  const mode = ref<'deps' | 'dependents' | 'both'>('deps')

  // Blast radius
  const blastRadius = ref<BlastRadiusResult | null>(null)
  const blastLoading = ref(false)

  async function search() {
    if (!searchFile.value) return
    loading.value = true
    error.value = ''
    try {
      if (mode.value === 'deps' || mode.value === 'both') {
        const deps = await fetchDependencies(searchFile.value, depth.value)
        nodes.value = deps.nodes
        links.value = deps.links
      }
      if (mode.value === 'dependents') {
        const deps = await fetchDependents(searchFile.value, depth.value)
        nodes.value = deps.nodes
        links.value = deps.links
      }
      if (mode.value === 'both') {
        const revDeps = await fetchDependents(searchFile.value, depth.value)
        // Merge, deduplicate nodes
        const nodeMap = new Map(nodes.value.map(n => [n.id, n]))
        for (const n of revDeps.nodes) nodeMap.set(n.id, n)
        nodes.value = Array.from(nodeMap.values())
        links.value = [...links.value, ...revDeps.links]
      }
    } catch (e: any) {
      error.value = e.message || 'Graph search failed'
    } finally {
      loading.value = false
    }
  }

  async function analyzeBlastRadius() {
    if (!searchFile.value) return
    blastLoading.value = true
    try {
      blastRadius.value = await fetchBlastRadius(searchFile.value)
    } catch (e: any) {
      error.value = e.message || 'Blast radius analysis failed'
    } finally {
      blastLoading.value = false
    }
  }

  return {
    nodes, links, loading, error, searchFile, depth, mode,
    blastRadius, blastLoading,
    search, analyzeBlastRadius,
  }
})
