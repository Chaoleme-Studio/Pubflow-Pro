<script setup lang="ts">
import { computed, ref } from 'vue';
import SiteHeader from './components/SiteHeader.vue';
import AdminPage from './pages/AdminPage.vue';
import DownloadPage from './pages/DownloadPage.vue';
import HomePage from './pages/HomePage.vue';
import NotFoundPage from './pages/NotFoundPage.vue';
import PurchasePage from './pages/PurchasePage.vue';

const path = ref(window.location.pathname);

const currentView = computed(() => {
  if (path.value.startsWith('/admin')) return 'admin';
  if (path.value.startsWith('/buy')) return 'buy';
  if (path.value.startsWith('/downloads')) return 'downloads';
  if (path.value === '/') return 'home';
  return 'notFound';
});

function navigate(href: string) {
  window.history.pushState({}, '', href);
  path.value = window.location.pathname;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('popstate', () => {
  path.value = window.location.pathname;
});
</script>

<template>
  <div class="app-shell" :class="`view-${currentView}`">
    <SiteHeader v-if="currentView !== 'admin'" :navigate="navigate" :current-path="path" />
    <KeepAlive :max="4">
      <HomePage v-if="currentView === 'home'" :navigate="navigate" />
      <PurchasePage v-else-if="currentView === 'buy'" :navigate="navigate" />
      <DownloadPage v-else-if="currentView === 'downloads'" />
      <AdminPage v-else-if="currentView === 'admin'" />
      <NotFoundPage v-else :navigate="navigate" />
    </KeepAlive>
  </div>
</template>
