<script setup lang="ts">
import { computed } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import SiteHeader from './components/SiteHeader.vue';
import { useSiteSeo } from './seo';

const route = useRoute();
const isStandalone = computed(() => Boolean(route.meta.standalone) || route.name === 'publish-remote');
const currentView = computed(() => {
  const routeName = typeof route.name === 'string' ? route.name : 'not-found';
  return routeName.startsWith('not-found') ? 'not-found' : routeName;
});

useSiteSeo();
</script>

<template>
  <div class="app-shell" :class="`view-${currentView}`">
    <SiteHeader v-if="!isStandalone" />
    <RouterView v-slot="{ Component }">
      <KeepAlive :max="4">
        <component :is="Component" />
      </KeepAlive>
    </RouterView>
  </div>
</template>
