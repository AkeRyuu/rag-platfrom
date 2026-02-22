import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/overview',
    },
    {
      path: '/overview',
      name: 'overview',
      component: () => import('@/pages/OverviewPage.vue'),
    },
    {
      path: '/memory',
      name: 'memory',
      component: () => import('@/pages/MemoryPage.vue'),
    },
    {
      path: '/collections',
      name: 'collections',
      component: () => import('@/pages/CollectionsPage.vue'),
    },
  ],
})

export default router
