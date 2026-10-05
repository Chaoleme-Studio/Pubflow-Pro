import type { RouteRecordRaw } from 'vue-router';

const adminSections = [
  'overview',
  'products',
  'versions',
  'users',
  'licenses',
  'leases',
  'selectors',
] as const;

const adminRoutes: RouteRecordRaw[] = adminSections.map((section) => ({
  path: `/admin/${section}`,
  name: `admin-${section}`,
  component: () => import('./pages/AdminRoute.vue'),
  meta: { standalone: true, adminView: section },
}));

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
    redirect: { name: 'admin-overview' },
  },
  ...adminRoutes,
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
