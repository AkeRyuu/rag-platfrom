<script setup lang="ts">
import { computed } from 'vue'
import Tag from 'primevue/tag'

const props = defineProps<{
  activities: Array<{
    id?: string
    tool?: string
    type?: string
    query?: string
    timestamp?: string
  }>
}>()

const TOOL_COLORS: Record<string, string> = {
  search: '#3B82F6',
  search_codebase: '#3B82F6',
  hybrid_search: '#3B82F6',
  recall: '#22C55E',
  remember: '#22C55E',
  record_adr: '#22C55E',
  get_patterns: '#22C55E',
  find_symbol: '#8B5CF6',
  search_graph: '#8B5CF6',
  ask_codebase: '#F97316',
  context_briefing: '#F97316',
}

function toolColor(tool: string): string {
  return TOOL_COLORS[tool] || '#94A3B8'
}

function toolCategory(tool: string): string {
  if (/search|find|hybrid/i.test(tool)) return 'search'
  if (/memory|recall|remember|adr|pattern/i.test(tool)) return 'memory'
  return 'analytics'
}

const categorySeverity: Record<string, string> = {
  search: 'info',
  memory: 'success',
  analytics: 'warn',
}
</script>

<template>
  <div v-if="activities.length > 0" style="display: flex; flex-direction: column; gap: 0.5rem;">
    <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.25rem;">Activity Timeline</div>

    <!-- Horizontal bar visualization -->
    <div style="display: flex; gap: 2px; height: 24px; background: var(--p-surface-100); border-radius: 4px; overflow: hidden;">
      <div
        v-for="(act, i) in activities"
        :key="act.id || i"
        v-tooltip="act.tool || act.type || 'unknown'"
        :style="{
          flex: '1',
          background: toolColor(act.tool || act.type || ''),
          borderRadius: '2px',
          cursor: 'default',
          transition: 'opacity 0.15s',
        }"
        class="timeline-bar"
      />
    </div>

    <!-- Legend -->
    <div style="display: flex; gap: 0.75rem; font-size: 0.75rem; color: var(--p-text-muted-color);">
      <span><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3B82F6; margin-right: 4px;" />Search</span>
      <span><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22C55E; margin-right: 4px;" />Memory</span>
      <span><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #8B5CF6; margin-right: 4px;" />Analytics</span>
    </div>

    <!-- Activity list -->
    <div style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.25rem;">
      <div
        v-for="(act, i) in activities.slice().reverse()"
        :key="act.id || i"
        style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; padding: 0.25rem 0;"
      >
        <Tag :value="act.tool || act.type || '?'" :severity="(categorySeverity[toolCategory(act.tool || '')] || 'secondary') as any" style="font-size: 0.65rem;" />
        <span v-if="act.query" style="color: var(--p-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          {{ act.query }}
        </span>
        <span v-if="act.timestamp" style="margin-left: auto; color: var(--p-text-muted-color); font-size: 0.7rem; white-space: nowrap;">
          {{ new Date(act.timestamp).toLocaleTimeString() }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-bar:hover {
  opacity: 0.7;
}
</style>
