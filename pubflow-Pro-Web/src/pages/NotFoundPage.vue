<script setup lang="ts">
defineProps<{
  navigate: (href: string) => void;
}>();
</script>

<template>
  <main class="not-found-page">
    <section>
      <span>404</span>
      <h1>页面不存在</h1>
      <p>这个地址没有对应的 PubFlow 页面。</p>
      <button class="primary-button" type="button" @click="navigate('/')">返回首页</button>
    </section>
  </main>
</template>
