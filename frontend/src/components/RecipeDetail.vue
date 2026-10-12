<script setup>
/**
 * 菜谱详情弹窗
 * - 展示完整食材与全部烹饪步骤
 * - 支持 ESC 关闭、遮罩点击关闭、打开时锁定页面滚动
 * - 焦点陷阱：Tab 在弹窗内的可聚焦元素之间循环，不逃逸到背景
 */
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'

const props = defineProps({
  recipe: { type: Object, default: null },
})

const emit = defineEmits(['close'])

const panelRef = ref(null)

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function onKeydown(event) {
  if (event.key === 'Escape') {
    emit('close')
    return
  }
  // 焦点陷阱：把 Tab 循环限制在弹窗内部
  if (event.key === 'Tab' && panelRef.value) {
    const nodes = Array.from(panelRef.value.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null
    )
    if (!nodes.length) {
      event.preventDefault()
      panelRef.value.focus()
      return
    }
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement

    if (event.shiftKey && (active === first || !panelRef.value.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }
}

/** 打开时锁滚动、聚焦面板；关闭时恢复 */
watch(
  () => props.recipe,
  async (value) => {
    document.body.style.overflow = value ? 'hidden' : ''
    if (value) {
      await nextTick()
      panelRef.value?.focus()
    }
  }
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div v-if="recipe" class="detail-overlay" @click.self="emit('close')">
    <div
      ref="panelRef"
      class="detail-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      tabindex="-1"
    >
      <button type="button" class="detail-close" aria-label="关闭详情" @click="emit('close')">
        ✕
      </button>

      <p class="detail-kicker">RECIPE DETAIL</p>
      <h2 id="detail-title" class="detail-title">{{ recipe.name }}</h2>

      <div class="detail-metrics">
        <div><strong>{{ recipe.minutes }}</strong><span>分钟</span></div>
        <div><strong>{{ (recipe.ingredients || []).length }}</strong><span>种食材</span></div>
        <div><strong>{{ (recipe.steps || []).length }}</strong><span>个步骤</span></div>
      </div>

      <div class="detail-tags">
        <span v-for="tag in recipe.tags" :key="tag">{{ tag }}</span>
      </div>

      <section class="detail-block">
        <h3>所需食材</h3>
        <ul class="detail-ingredients">
          <li v-for="item in recipe.ingredients" :key="item">{{ item }}</li>
        </ul>
      </section>

      <section class="detail-block">
        <h3>烹饪步骤</h3>
        <ol class="detail-steps">
          <li v-for="(step, i) in recipe.steps" :key="i">
            <span class="step-no">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="step-text">{{ step }}</span>
          </li>
        </ol>
      </section>

      <p class="detail-footnote">
        菜谱编号 {{ recipe.recipeId }} · 数据来源 {{ recipe.source || 'db' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(18, 59, 49, 0.55);
  backdrop-filter: blur(3px);
  animation: fade-in 0.2s ease;
}
.detail-panel {
  width: min(620px, 100%);
  max-height: 86vh;
  overflow-y: auto;
  padding: 34px 36px 30px;
  position: relative;
  border-radius: 4px;
  background: var(--card);
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.28);
  animation: rise 0.25s ease;
  outline: none;
}
.detail-close {
  position: absolute;
  right: 20px;
  top: 20px;
  width: 40px;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 50%;
  color: var(--ink-soft);
  background: #fff;
  font-size: var(--fs-sm);
  transition: 0.2s ease;
}
.detail-close:hover {
  border-color: var(--ink);
  background: var(--lime);
}
.detail-kicker {
  margin: 0;
  color: var(--orange-ink);
  font-size: var(--fs-micro);
  font-weight: 700;
  letter-spacing: 0.18em;
}
.detail-title {
  margin: 10px 0 0;
  font-size: 28px;
  letter-spacing: -0.045em;
}
.detail-metrics {
  display: flex;
  gap: 26px;
  margin-top: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid #edf1ed;
}
.detail-metrics strong {
  display: block;
  color: var(--ink);
  font-size: var(--fs-lg);
  line-height: 1;
}
.detail-metrics span {
  display: block;
  margin-top: 5px;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
}
.detail-tags span {
  padding: 4px 10px;
  color: var(--ink-soft);
  background: #eef4ed;
  font-size: var(--fs-xs);
}
.detail-block {
  margin-top: 24px;
}
.detail-block h3 {
  margin: 0 0 11px;
  font-size: var(--fs-sm);
  letter-spacing: 0.02em;
}
.detail-ingredients {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.detail-ingredients li {
  padding: 5px 11px;
  border: 1px solid var(--line);
  border-radius: 20px;
  color: var(--ink-soft);
  background: #fbfcfa;
  font-size: var(--fs-sm);
}
.detail-steps {
  margin: 0;
  padding: 0;
  list-style: none;
}
.detail-steps li {
  display: flex;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px dashed #e6ece6;
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}
.detail-steps li:last-child {
  border-bottom: 0;
}
.step-no {
  flex: 0 0 auto;
  color: var(--lime);
  background: var(--ink);
  font-size: var(--fs-micro);
  font-weight: 700;
  height: 22px;
  min-width: 26px;
  display: grid;
  place-items: center;
  border-radius: 2px;
}
.step-text {
  flex: 1;
  line-height: 1.7;
}
.detail-footnote {
  margin: 22px 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  letter-spacing: 0.04em;
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}
@media (max-width: 620px) {
  .detail-panel {
    padding: 28px 20px 24px;
    max-height: 90vh;
  }
  .detail-title {
    font-size: var(--fs-lg);
  }
  .detail-metrics {
    gap: 18px;
  }
  .detail-close {
    width: 44px;
    height: 44px;
  }
}
</style>
