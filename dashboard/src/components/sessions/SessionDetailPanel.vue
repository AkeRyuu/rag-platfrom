<script setup lang="ts">
import Card from 'primevue/card'
import Button from 'primevue/button'
import Chip from 'primevue/chip'
import Tag from 'primevue/tag'
import type { SessionDetail } from '@/types/session'

defineProps<{ session: SessionDetail }>()
const emit = defineEmits<{ close: []; 'end-session': [id: string] }>()
</script>

<template>
  <Card>
    <template #title>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span>Session Detail</span>
        <Button icon="pi pi-times" text size="small" @click="emit('close')" />
      </div>
    </template>
    <template #content>
      <div style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.875rem;">
        <div>
          <b>ID:</b>
          <code style="font-size: 0.8rem; margin-left: 0.25rem;">{{ session.id }}</code>
        </div>
        <div>
          <b>Status:</b>
          <Tag :severity="session.status === 'active' ? 'success' : 'secondary'" :value="session.status" style="margin-left: 0.25rem;" />
        </div>
        <div v-if="session.initialContext">
          <b>Context:</b> {{ session.initialContext }}
        </div>
        <div>
          <b>Started:</b> {{ new Date(session.startedAt).toLocaleString() }}
        </div>
        <div v-if="session.endedAt">
          <b>Ended:</b> {{ new Date(session.endedAt).toLocaleString() }}
        </div>

        <div v-if="session.currentFiles?.length">
          <b>Files:</b>
          <div style="display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.25rem;">
            <Chip v-for="f in session.currentFiles" :key="f" :label="f.split('/').pop() || f" v-tooltip="f" style="font-size: 0.75rem;" />
          </div>
        </div>

        <div v-if="session.toolsUsed?.length">
          <b>Tools Used:</b>
          <div style="display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.25rem;">
            <Chip v-for="t in session.toolsUsed" :key="t" :label="t" style="font-size: 0.75rem;" />
          </div>
        </div>

        <div v-if="session.recentQueries?.length">
          <b>Recent Queries:</b>
          <ul style="margin: 0.25rem 0 0; padding-left: 1.25rem; font-size: 0.8rem;">
            <li v-for="q in session.recentQueries" :key="q">{{ q }}</li>
          </ul>
        </div>

        <div v-if="session.status === 'active'" style="margin-top: 0.5rem;">
          <Button label="End Session" icon="pi pi-stop-circle" severity="warn" size="small" @click="emit('end-session', session.id)" />
        </div>
      </div>
    </template>
  </Card>
</template>
