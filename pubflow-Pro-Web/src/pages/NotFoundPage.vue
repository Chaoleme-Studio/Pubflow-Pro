<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <main class="not-found-page">
    <section>
      <span>404</span>
      <h1>页面不存在</h1>
      <p>这个地址没有对应的 PubFlow 页面。</p>
      <RouterLink class="primary-button" to="/">返回首页</RouterLink>
    </section>
  </main>
</template>
