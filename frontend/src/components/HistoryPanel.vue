<script setup>
/**
 * 历史记录面板
 * 默认只展示最近 3 条，可展开查看全部；点击「用这组条件」回填表单并重新推荐。
 */
import { computed, ref } from 'vue'
import { formatTime, modeLabel } from '@/utils/format'

const props = defineProps({
  /** 历史条目数组 */
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  /** 历史数据来源通道（backend / offline） */
  channel: { type: String, default: '' },
})

const emit = defineEmits(['replay'])

/** 折叠状态下展示的条数 */
const COLLAPSED_COUNT = 3
const expanded = ref(false)

const visibleItems = computed(() =>
  expanded.value ? props.items : props.items.slice(0, COLLAPSED_COUNT)
)

/** 是否值得显示展开按钮 */
const canExpand = computed(() => props.items.length > COLLAPSED_COUNT)

const channelHint = computed(() => {
  if (props.channel === 'backend') return '来源：后端 /api/recommendations/history'
  return '历史记录暂不可用（需后端服务）'
})

/** 「2 人 · 30 分钟 · 清淡 · 忌 花生」 */
function preferenceSummary(item) {
  const parts = [`${item.servings} 人`, `${item.maxMinutes} 分钟`, item.preference]
  if (item.allergy) parts.push(`忌 ${item.allergy}`)
  return parts.join(' · ')
}

/** 「番茄鸡胸肉意面、香菇青菜豆腐汤」 */
function resultNames(item) {
  const names = (item.recommendations || []).map((r) => r.name)
  return names.length ? names.join('、') : '（当次无匹配结果）'
}
</script>

<template>
  <section class="history-panel" aria-labelledby="history-title">
    <div class="history-head">
      <h3 id="history-title">最近推荐</h3>
      <span class="history-hint">{{ channelHint }}</span>
    </div>

    <p v-if="loading" class="history-state">正在读取历史记录…</p>

    <p v-else-if="!items.length" class="history-state">
      还没有推荐记录，完成一次推荐后会自动保存在这里。
    </p>

    <template v-else>
      <ul class="history-list">
        <li
          v-for="item in visibleItems"
          :key="item.id || item.createdAt"
          class="history-item"
        >
          <div class="history-meta">
            <span class="history-time">{{ formatTime(item.createdAt) }}</span>
            <span class="history-mode">{{ modeLabel(item.mode) }}</span>
          </div>
          <p class="history-cond">{{ preferenceSummary(item) }}</p>
          <p class="history-result">{{ resultNames(item) }}</p>
          <button type="button" class="history-replay" @click="emit('replay', item)">
            用这组条件
          </button>
        </li>
      </ul>

      <button
        v-if="canExpand"
        type="button"
        class="history-toggle"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : `展开全部 ${items.length} 条` }}
        <span aria-hidden="true">{{ expanded ? '↑' : '↓' }}</span>
      </button>
    </template>
  </section>
</template>

<style scoped>
.history-panel {
  margin-top: 62px;
  padding: 26px 28px 24px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--card);
}
.history-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.history-head h3 {
  margin: 0;
  font-size: var(--fs-lg);
  letter-spacing: -0.03em;
}
.history-hint {
  color: var(--muted);
  font-size: var(--fs-xs);
  letter-spacing: 0.04em;
}
.history-state {
  margin: 16px 0 0;
  color: var(--muted);
  font-size: var(--fs-sm);
}
.history-list {
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
.history-item {
  display: flex;
  flex-direction: column;
  padding: 14px 15px 13px;
  border: 1px solid var(--line);
  background: #fbfcfa;
}
.history-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.history-time {
  color: var(--ink);
  font-size: var(--fs-sm);
  font-weight: 700;
}
.history-mode {
  color: var(--muted-soft);
  font-size: var(--fs-xs);
}
.history-cond {
  margin: 9px 0 0;
  color: var(--ink-soft);
  font-size: var(--fs-sm);
}
.history-result {
  flex: 1;
  margin: 6px 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.6;
}
.history-replay {
  align-self: flex-start;
  margin-top: 12px;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 2px;
  color: var(--ink-soft);
  background: #fff;
  font-size: var(--fs-xs);
  transition: 0.2s ease;
}
.history-replay:hover {
  border-color: var(--ink);
  background: var(--lime);
  color: var(--ink);
}
.history-toggle {
  display: block;
  width: 100%;
  margin-top: 14px;
  padding: 11px 14px;
  border: 1px dashed var(--line);
  border-radius: 2px;
  color: var(--ink-soft);
  background: transparent;
  font-size: var(--fs-sm);
  transition: 0.2s ease;
}
.history-toggle span {
  margin-left: 6px;
  color: var(--muted);
}
.history-toggle:hover {
  border-color: var(--ink);
  background: #fbfcfa;
}
@media (max-width: 620px) {
  .history-panel {
    padding: 20px 18px;
  }
  .history-list {
    grid-template-columns: 1fr;
  }
  /* 移动端加大触控目标 */
  .history-replay {
    min-height: 44px;
    padding: 0 18px;
    font-size: var(--fs-sm);
  }
}
</style>
