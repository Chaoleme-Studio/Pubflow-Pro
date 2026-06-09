<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next';
import { onMounted, onUnmounted, ref } from 'vue';
import { navItems } from '../config/catalog';

const props = defineProps<{
  navigate: (href: string) => void;
  currentPath: string;
}>();

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
    <button class="brand" type="button" @click="navigate('/')">
      <span class="brand-mark">
        <img src="/icon.svg" alt="" aria-hidden="true" />
      </span>
      <span>PubFlow</span>
    </button>
    <nav class="top-nav" aria-label="主导航">
      <button v-for="item in navItems" :key="item.href" type="button" :class="{ active: props.currentPath === item.href }" :aria-current="props.currentPath === item.href ? 'page' : undefined" @click="navigate(item.href)">
        {{ item.label }}
      </button>
    </nav>
    <button class="header-cta" type="button" @click="navigate('/buy')">
      <Sparkles :size="16" />
      立即开通
    </button>
  </header>
</template>
