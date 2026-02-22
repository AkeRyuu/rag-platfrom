<script setup lang="ts">
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import ToggleSwitch from 'primevue/toggleswitch'
import Select from 'primevue/select'
import { useAppStore } from '@/stores/app'
import { useToast } from '@/composables/useToast'
import { useConfirm } from 'primevue/useconfirm'

const app = useAppStore()
const toast = useToast()
const confirm = useConfirm()

const refreshOptions = [
  { label: 'Off', value: 0 },
  { label: '30 seconds', value: 30000 },
  { label: '1 minute', value: 60000 },
  { label: '5 minutes', value: 300000 },
]

async function testConnection() {
  await app.checkHealth()
  if (app.isConnected) {
    toast.success('Connection successful')
  } else {
    toast.error('Connection failed', app.healthError)
  }
}

function handleClearStorage() {
  confirm.require({
    message: 'This will clear all localStorage data (project, API key, preferences). Continue?',
    header: 'Clear localStorage',
    acceptLabel: 'Clear',
    rejectLabel: 'Cancel',
    accept: () => {
      app.clearAllStorage()
      toast.info('localStorage cleared')
    },
  })
}
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 40rem;">
    <!-- API Connection -->
    <Card>
      <template #title>API Connection</template>
      <template #content>
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          <div>
            <label style="font-size: 0.875rem; font-weight: 600; display: block; margin-bottom: 0.25rem;">API URL</label>
            <InputText v-model="app.apiUrl" placeholder="http://localhost:3100" style="width: 100%;" />
          </div>
          <div>
            <label style="font-size: 0.875rem; font-weight: 600; display: block; margin-bottom: 0.25rem;">API Key</label>
            <Password v-model="app.apiKey" :feedback="false" toggleMask style="width: 100%;" :inputStyle="{ width: '100%' }" />
          </div>
          <div>
            <label style="font-size: 0.875rem; font-weight: 600; display: block; margin-bottom: 0.25rem;">Project Name</label>
            <InputText v-model="app.currentProject" placeholder="my-project" style="width: 100%;" />
          </div>
          <Button label="Test Connection" icon="pi pi-check-circle" size="small" @click="testConnection" />
        </div>
      </template>
    </Card>

    <!-- Appearance -->
    <Card>
      <template #title>Appearance</template>
      <template #content>
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 0.875rem;">Dark Mode</span>
            <ToggleSwitch v-model="app.isDark" />
          </div>
          <div>
            <label style="font-size: 0.875rem; font-weight: 600; display: block; margin-bottom: 0.25rem;">Auto-Refresh Interval</label>
            <Select v-model="app.autoRefreshInterval" :options="refreshOptions" optionLabel="label" optionValue="value" style="width: 100%;" />
          </div>
        </div>
      </template>
    </Card>

    <!-- Danger Zone -->
    <Card>
      <template #title>
        <span style="color: var(--p-red-500);">Danger Zone</span>
      </template>
      <template #content>
        <Button label="Clear localStorage" icon="pi pi-trash" severity="danger" outlined @click="handleClearStorage" />
      </template>
    </Card>
  </div>
</template>
