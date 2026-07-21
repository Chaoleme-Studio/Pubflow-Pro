<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const AdminPage = defineAsyncComponent(() => import('./AdminPage.vue'));
</script>

<template>
  <ClientOnly>
    <AdminPage />
    <template #placeholder>
      <main class="admin-page" aria-busy="true"></main>
    </template>
  </ClientOnly>
</template>
