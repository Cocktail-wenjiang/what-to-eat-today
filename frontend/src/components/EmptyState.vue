<script setup>
/**
 * 空状态
 * - 首次进入：引导填写需求
 * - 有搜索但无结果：给出可操作的放宽建议，并显示放宽后能命中多少条
 */
const props = defineProps({
  hasSearched: { type: Boolean, default: false },
  reason: { type: String, default: '' },
  /** 放宽建议列表 [{ label, count, patch }]，patch 为要合并进表单的字段 */
  suggestions: { type: Array, default: () => [] },
})

const emit = defineEmits(['retry', 'apply'])
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon">{{ hasSearched ? '✦' : '◐' }}</div>
    <h3>{{ hasSearched ? '换个条件，再试一次' : '下一顿，从这里开始' }}</h3>

    <p v-if="hasSearched" class="empty-desc">
      没有同时满足用时、口味和忌口要求的菜谱。<br />
      下面是放宽某个条件后能命中的数量，点一下即可直接重试。
    </p>
    <p v-else class="empty-desc">填写上面的需求，我们会从菜谱库里挑选刚刚好的搭配。</p>

    <ul v-if="hasSearched && suggestions.length" class="suggest-list">
      <li v-for="item in suggestions" :key="item.label">
        <button type="button" class="suggest-item" @click="emit('apply', item.patch)">
          <span class="suggest-label">{{ item.label }}</span>
          <span class="suggest-count">
            <b>{{ item.count }}</b> 条
            <i aria-hidden="true">→</i>
          </span>
        </button>
      </li>
    </ul>

    <p v-if="hasSearched && reason" class="empty-reason">接口返回：{{ reason }}</p>

    <button
      v-if="hasSearched && !suggestions.length"
      type="button"
      class="empty-action"
      @click="emit('retry')"
    >
      放宽条件重新推荐
    </button>
  </div>
</template>

<style scoped>
.empty-state {
  padding: 46px 20px;
  border: 1px dashed #cbd9d0;
  text-align: center;
}
.empty-icon {
  color: var(--orange-ink);
  font-size: 28px;
}
.empty-state h3 {
  margin: 8px 0 6px;
  font-size: var(--fs-lg);
  letter-spacing: -0.03em;
}
.empty-desc {
  max-width: 400px;
  margin: 0 auto;
  color: var(--muted);
  font-size: var(--fs-sm);
  line-height: 1.8;
}
.suggest-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  max-width: 560px;
  margin: 22px auto 0;
  padding: 0;
  list-style: none;
}
.suggest-item {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: 2px;
  color: var(--ink-soft);
  background: #fff;
  font-size: var(--fs-sm);
  transition: 0.2s ease;
}
.suggest-item:hover {
  border-color: var(--ink);
  background: var(--mint);
  color: var(--ink);
}
.suggest-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-left: 12px;
  border-left: 1px solid var(--line);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.suggest-count b {
  color: var(--ink);
  font-size: var(--fs-sm);
}
.suggest-count i {
  font-style: normal;
  color: var(--orange-ink);
}
.empty-reason {
  margin-top: 16px;
  font-size: var(--fs-xs);
  color: var(--muted-soft);
}
.empty-action {
  margin-top: 18px;
  min-height: 44px;
  padding: 0 22px;
  border: 1px solid var(--ink);
  border-radius: 2px;
  color: var(--ink);
  background: var(--lime);
  font-size: var(--fs-sm);
  font-weight: 600;
  transition: 0.2s ease;
}
.empty-action:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 20px rgba(19, 61, 49, 0.16);
}
</style>
