import { createRouter, createWebHistory } from 'vue-router'
import AirView from '@/components/air/AirView.vue'
import SpaceView from '@/components/space/SpaceView.vue'
import SeaView from '@/components/sea/SeaView.vue'
import LandView from '@/components/land/LandView.vue'
import SdrView from '@/components/sdr/SdrView.vue'
import { useAppStore } from '@/stores/app'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',       redirect: '/air/' },
    { path: '/air/',   component: AirView,   meta: { domain: 'air'   } },
    { path: '/space/', component: SpaceView, meta: { domain: 'space' } },
    { path: '/sea/',   component: SeaView,   meta: { domain: 'sea'   } },
    { path: '/land/',  component: LandView,  meta: { domain: 'land'  } },
    { path: '/sdr/',   component: SdrView,   meta: { domain: 'sdr'   } },
    { path: '/docs/',  redirect: '/air/'    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const domain = to.meta?.domain as string | undefined
  if (!domain) return
  const appStore = useAppStore()
  if (!appStore.enabledDomains.includes(domain)) {
    const first = appStore.firstEnabledDomain()
    return `/${first}/`
  }
})

router.afterEach((to) => {
  const domain = (to.meta?.domain as string) ?? ''
  document.body.dataset.domain = domain
})

export default router
