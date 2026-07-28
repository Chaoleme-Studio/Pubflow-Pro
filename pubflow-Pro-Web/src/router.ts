import type { RouteRecordRaw } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('./pages/HomePage.vue'),
  },
  {
    path: '/buy',
    name: 'buy',
    component: () => import('./pages/PurchasePage.vue'),
  },
  {
    path: '/downloads',
    name: 'downloads',
    component: () => import('./pages/DownloadPage.vue'),
  },
  {
    path: '/license',
    name: 'license',
    component: () => import('./pages/LicenseServicePage.vue'),
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('./pages/AdminRoute.vue'),
  },
  {
    path: '/publish',
    name: 'publish-remote',
    component: () => import('./pages/RemotePublishPage.vue'),
  },
  {
    path: '/404',
    name: 'not-found-static',
    component: () => import('./pages/NotFoundPage.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('./pages/NotFoundPage.vue'),
  },
];
