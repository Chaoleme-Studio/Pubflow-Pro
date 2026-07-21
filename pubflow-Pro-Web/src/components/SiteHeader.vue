<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next';
import { onMounted, onUnmounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { navItems } from '../config/catalog';

const route = useRoute();
const headerRef = ref<HTMLElement | null>(null);

function onScroll() {
  if (headerRef.value) {
    headerRef.value.classList.toggle('scrolled', window.scrollY > 20);
  }
}

onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
onUnmounted(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <header ref="headerRef" class="site-header">
    <RouterLink class="brand" to="/">
      <span class="brand-mark">
        <img src="/icon.svg" alt="" aria-hidden="true" />
      </span>
      <span>PubFlow</span>
    </RouterLink>
    <nav class="top-nav" aria-label="主导航">
      <RouterLink v-for="item in navItems" :key="item.href" :to="item.href" :class="{ active: route.path === item.href }" :aria-current="route.path === item.href ? 'page' : undefined">
        {{ item.label }}
      </RouterLink>
    </nav>
    <RouterLink class="header-cta" to="/buy">
      <Sparkles :size="16" />
      立即开通
    </RouterLink>
  </header>
</template>
