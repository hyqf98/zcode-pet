/**
 * 路由配置。
 *
 * /        → 管理窗口主视图（PetManager）
 * /pet     → 悬浮宠物窗口（PetView）
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'manager',
    component: () => import('@/views/PetManager/index.vue')
  },
  {
    path: '/pet',
    name: 'pet',
    component: () => import('@/views/PetView/PetView.vue')
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})
