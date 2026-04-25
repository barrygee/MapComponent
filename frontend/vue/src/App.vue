<template>
  <header id="nav">
    <div id="nav-logo">
      <img id="logo-img" src="/assets/logo.svg" alt="SENTINEL OS">
    </div>
    <nav id="nav-right">
      <RouterLink
        v-for="[domain, label] in navDomains"
        :key="domain"
        :to="`/${domain}/`"
        class="nav-link"
        active-class="nav-link--active"
        :data-domain="domain"
      >{{ label }}</RouterLink>
    </nav>
  </header>

  <RouterView />

  <MapSidebar ref="sidebarRef" :hide-tabs="isSdrRoute">
    <template #radio>
      <SdrTabPanel />
    </template>
  </MapSidebar>

  <AppFooter
    :sidebar-open="sidebarOpen"
    @toggle-sidebar="sidebarRef?.toggle()"
    @toggle-notifications="sidebarRef?.switchTab('alerts')"
    @toggle-tracking="sidebarRef?.switchTab('tracking')"
    @toggle-docs="docsRef?.toggle()"
  />

  <SettingsPanel />
  <DocsPanel ref="docsRef" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import MapSidebar from '@/components/shared/MapSidebar.vue'
import AppFooter from '@/components/shared/AppFooter.vue'
import SettingsPanel from '@/components/shared/SettingsPanel.vue'
import DocsPanel from '@/components/shared/DocsPanel.vue'
import SdrTabPanel from '@/components/sdr/SdrTabPanel.vue'
import { useUserLocation } from '@/composables/useUserLocation'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const appStore = useAppStore()
const { start: startGps } = useUserLocation()

onMounted(() => { startGps() })

useDocumentEvent('air-open-search', () => sidebarRef.value?.switchTab('search'))
useDocumentEvent('open-space-search', () => sidebarRef.value?.switchTab('search'))

const isSdrRoute = computed(() => route.path.startsWith('/sdr'))

watch(isSdrRoute, (isSdr) => {
  if (isSdr) {
    sidebarRef.value?.openRadioTab()
  } else {
    sidebarRef.value?.closeRadioTab()
  }
})

const sidebarRef = ref<InstanceType<typeof MapSidebar> | null>(null)
const docsRef    = ref<InstanceType<typeof DocsPanel>   | null>(null)

const sidebarOpen = computed(() => sidebarRef.value?.open ?? false)

const ALL_NAV_DOMAINS: [string, string][] = [
  ['air',   'AIR'],
  ['space', 'SPACE'],
  ['sea',   'SEA'],
  ['land',  'LAND'],
  ['sdr',   'SDR'],
]

const navDomains = computed(() =>
  ALL_NAV_DOMAINS.filter(([d]) => appStore.enabledDomains.includes(d))
)
</script>
