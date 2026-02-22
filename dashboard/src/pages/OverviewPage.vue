<script setup lang="ts">
import { onMounted } from 'vue'
import Card from 'primevue/card'
import ProgressSpinner from 'primevue/progressspinner'
import HealthGauges from '@/components/overview/HealthGauges.vue'
import ToolUsageChart from '@/components/overview/ToolUsageChart.vue'
import TopToolsChart from '@/components/overview/TopToolsChart.vue'
import RecentSessionsList from '@/components/overview/RecentSessionsList.vue'
import KnowledgeGapsAlert from '@/components/overview/KnowledgeGapsAlert.vue'
import QualityMetricsCard from '@/components/overview/QualityMetricsCard.vue'
import { useOverviewStore } from '@/stores/overview'

const store = useOverviewStore()

onMounted(() => store.loadAll())
</script>

<template>
  <div v-if="store.loading" style="display: flex; justify-content: center; padding: 3rem;">
    <ProgressSpinner />
  </div>
  <div v-else style="display: grid; grid-template-columns: repeat(12, 1fr); gap: 1rem;">
    <!-- Health Gauges - full width -->
    <div style="grid-column: span 12;">
      <HealthGauges :stats="store.toolStats" />
    </div>

    <!-- Tool Usage Chart -->
    <Card style="grid-column: span 8;">
      <template #title>Tool Usage by Hour</template>
      <template #content>
        <ToolUsageChart :calls-by-hour="store.toolStats?.callsByHour" />
      </template>
    </Card>

    <!-- Quality Metrics -->
    <div style="grid-column: span 4;">
      <QualityMetricsCard :metrics="store.qualityMetrics" />
    </div>

    <!-- Top Tools -->
    <Card style="grid-column: span 6;">
      <template #title>Top Tools</template>
      <template #content>
        <TopToolsChart :top-tools="store.toolStats?.topTools" />
      </template>
    </Card>

    <!-- Knowledge Gaps -->
    <Card style="grid-column: span 6;">
      <template #title>Knowledge Gaps</template>
      <template #content>
        <KnowledgeGapsAlert :gaps="store.knowledgeGaps" />
      </template>
    </Card>

    <!-- Recent Sessions -->
    <Card style="grid-column: span 12;">
      <template #title>Recent Sessions</template>
      <template #content>
        <RecentSessionsList :sessions="store.recentSessions" />
      </template>
    </Card>
  </div>
</template>
