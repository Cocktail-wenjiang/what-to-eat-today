<script setup>
/**
 * 结果区骨架屏 —— 请求进行中显示，避免布局跳动与白屏
 */
</script>

<template>
  <div class="skeleton-list" aria-live="polite" aria-busy="true">
    <article v-for="n in 3" :key="n" class="skeleton-card">
      <div class="skeleton-topline">
        <span class="sk-line sk-index"></span>
        <span class="sk-line sk-time"></span>
      </div>
      <span class="sk-line sk-title"></span>
      <span class="sk-line sk-sub"></span>
      <div class="skeleton-tags">
        <span class="sk-line sk-tag"></span>
        <span class="sk-line sk-tag"></span>
      </div>
      <span class="sk-line sk-line-full"></span>
      <span class="sk-line sk-line-full"></span>
      <span class="sk-line sk-line-short"></span>
    </article>
    <span class="sr-only">正在加载推荐结果</span>
  </div>
</template>

<style scoped>
.skeleton-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
}
.skeleton-card {
  min-height: 300px;
  padding: 22px 21px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--line);
  border-top: 4px solid #e3eae4;
  background: var(--card);
}
.skeleton-topline {
  display: flex;
  justify-content: space-between;
}
.sk-line {
  display: block;
  height: 12px;
  border-radius: 2px;
  background: linear-gradient(90deg, #eef2ee 25%, #e2e9e3 37%, #eef2ee 63%);
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
}
.sk-index {
  width: 26px;
}
.sk-time {
  width: 52px;
}
.sk-title {
  height: 20px;
  width: 68%;
  margin-top: 10px;
}
.sk-sub {
  width: 88%;
}
.skeleton-tags {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.sk-tag {
  width: 46px;
  height: 20px;
}
.sk-line-full {
  width: 100%;
  margin-top: 6px;
}
.sk-line-short {
  width: 62%;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@keyframes shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
@media (max-width: 820px) {
  .skeleton-list {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 620px) {
  .skeleton-list {
    grid-template-columns: 1fr;
  }
}
</style>
