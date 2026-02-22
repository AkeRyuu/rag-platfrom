<script setup lang="ts">
import { ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import type { QuarantineMemory } from '@/types/memory'

defineProps<{ memories: QuarantineMemory[] }>()
const emit = defineEmits<{
  validate: [id: string, validated: boolean]
  promote: [id: string, reason: string]
}>()

const showPromoteDialog = ref(false)
const promoteId = ref('')
const promoteReason = ref('human_validated')

const reasonOptions = [
  { label: 'Human Validated', value: 'human_validated' },
  { label: 'PR Merged', value: 'pr_merged' },
  { label: 'Tests Passed', value: 'tests_passed' },
]

function openPromote(id: string) {
  promoteId.value = id
  promoteReason.value = 'human_validated'
  showPromoteDialog.value = true
}

function confirmPromote() {
  emit('promote', promoteId.value, promoteReason.value)
  showPromoteDialog.value = false
}
</script>

<template>
  <DataTable :value="memories" size="small" stripedRows>
    <Column field="content" header="Content" style="max-width: 30rem;">
      <template #body="{ data }">
        <span style="font-size: 0.875rem;">{{ data.content?.slice(0, 120) }}{{ (data.content?.length ?? 0) > 120 ? '...' : '' }}</span>
      </template>
    </Column>
    <Column field="type" header="Type">
      <template #body="{ data }">
        <Tag :value="data.type" />
      </template>
    </Column>
    <Column field="confidence" header="Conf.">
      <template #body="{ data }">
        {{ data.confidence != null ? (data.confidence * 100).toFixed(0) + '%' : '—' }}
      </template>
    </Column>
    <Column header="Actions" style="width: 12rem;">
      <template #body="{ data }">
        <div style="display: flex; gap: 0.25rem;">
          <Button icon="pi pi-check" severity="success" text size="small" title="Validate" @click="emit('validate', data.id, true)" />
          <Button icon="pi pi-times" severity="danger" text size="small" title="Reject" @click="emit('validate', data.id, false)" />
          <Button icon="pi pi-arrow-up" severity="info" text size="small" title="Promote" @click="openPromote(data.id)" />
        </div>
      </template>
    </Column>
  </DataTable>

  <Dialog v-model:visible="showPromoteDialog" header="Promote Memory" modal style="width: 24rem;">
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <label>Reason for promotion:</label>
      <Select v-model="promoteReason" :options="reasonOptions" optionLabel="label" optionValue="value" />
    </div>
    <template #footer>
      <Button label="Cancel" text @click="showPromoteDialog = false" />
      <Button label="Promote" @click="confirmPromote" />
    </template>
  </Dialog>
</template>
