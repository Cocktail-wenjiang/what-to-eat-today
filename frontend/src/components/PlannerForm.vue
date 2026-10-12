<script setup>
/**
 * 需求输入表单
 * - 三个数值/文本字段 + 口味快捷标签
 * - 字段失焦即时校验，提交前整体校验
 * - 当前数据链路（后端 / 云函数 / 云端直连）状态提示
 */
import { computed } from 'vue'
import { PREFERENCE_OPTIONS, LIMITS } from '@/utils/validators'

const props = defineProps({
  form: { type: Object, required: true },
  errors: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
  statusText: { type: String, default: '' },
  channelLabel: { type: String, default: '' },
  degraded: { type: Boolean, default: false },
  status: { type: String, default: 'idle' },
  /** 流式推送进度 { current, total } */
  progress: { type: Object, default: () => ({ current: 0, total: 0 }) },
})

const emit = defineEmits(['submit', 'reset', 'validate', 'choose-preference'])

const hasErrors = computed(() => Object.keys(props.errors).length > 0)

/** 状态条样式类：错误 / 成功 / 加载 / 空闲 */
const statusClass = computed(() => ({
  'status-error': props.status === 'error',
  'status-success': props.status === 'success',
  'status-loading': props.status === 'loading',
}))

/** 流式进度百分比；总数未知时返回 null（显示为不确定态滑动动画） */
const progressPercent = computed(() => {
  const { current, total } = props.progress || {}
  if (!total) return null
  return Math.round((current / total) * 100)
})
</script>

<template>
  <section class="planner" aria-labelledby="planner-title">
    <div class="section-heading">
      <div>
        <p class="section-kicker">YOUR INPUT</p>
        <h2 id="planner-title">告诉我你的需求</h2>
      </div>
      <span class="channel-badge" :class="{ degraded }">
        <i></i>{{ channelLabel }}
      </span>
    </div>

    <form class="planner-form" novalidate @submit.prevent="emit('submit')">
      <div class="field-grid">
        <label class="field">
          <span>几个人吃</span>
          <div class="input-wrap" :class="{ invalid: errors.servings }">
            <input
              v-model.number="form.servings"
              type="number"
              :min="LIMITS.servings.min"
              :max="LIMITS.servings.max"
              step="1"
              aria-label="用餐人数"
              @blur="emit('validate', 'servings')"
            />
            <b>人</b>
          </div>
          <em v-if="errors.servings" class="field-error">{{ errors.servings }}</em>
          <em v-else class="field-tip">范围 {{ LIMITS.servings.min }}-{{ LIMITS.servings.max }}</em>
        </label>

        <label class="field">
          <span>最多用时</span>
          <div class="input-wrap" :class="{ invalid: errors.max_minutes }">
            <input
              v-model.number="form.max_minutes"
              type="number"
              :min="LIMITS.max_minutes.min"
              :max="LIMITS.max_minutes.max"
              step="5"
              aria-label="最多用时"
              @blur="emit('validate', 'max_minutes')"
            />
            <b>分钟</b>
          </div>
          <em v-if="errors.max_minutes" class="field-error">{{ errors.max_minutes }}</em>
          <em v-else class="field-tip">
            范围 {{ LIMITS.max_minutes.min }}-{{ LIMITS.max_minutes.max }} 分钟
          </em>
        </label>

        <label class="field allergy-field">
          <span>需要避开的食材</span>
          <div class="input-wrap" :class="{ invalid: errors.allergy }">
            <input
              v-model.trim="form.allergy"
              type="text"
              placeholder="例如：花生（可留空）"
              :maxlength="LIMITS.allergy.maxLen"
              aria-label="忌口食材"
              @blur="emit('validate', 'allergy')"
            />
          </div>
          <em v-if="errors.allergy" class="field-error">{{ errors.allergy }}</em>
          <em v-else class="field-tip">
            可留空；{{ (form.allergy || '').length }}/{{ LIMITS.allergy.maxLen }}
          </em>
        </label>
      </div>

      <div class="preference-row">
        <span class="field-label">今天想吃</span>
        <div class="preference-list" role="group" aria-label="口味偏好">
          <button
            v-for="item in PREFERENCE_OPTIONS"
            :key="item"
            type="button"
            :class="['preference-chip', { active: form.preference === item }]"
            :aria-pressed="form.preference === item"
            @click="emit('choose-preference', item)"
          >
            {{ item }}
          </button>
        </div>
      </div>
      <em v-if="errors.preference" class="field-error preference-error">
        {{ errors.preference }}
      </em>

      <div v-if="loading" class="stream-progress" aria-hidden="true">
        <div
          class="stream-progress-bar"
          :class="{ indeterminate: progressPercent === null }"
          :style="progressPercent === null ? null : { width: progressPercent + '%' }"
        ></div>
      </div>

      <div class="planner-footer">
        <p class="status" :class="statusClass" role="status">
          <span class="status-icon">
            {{ status === 'error' ? '!' : status === 'success' ? '✓' : '↳' }}
          </span>
          {{ statusText }}
        </p>
        <div class="planner-actions">
          <button
            type="button"
            class="ghost-button"
            :disabled="loading"
            @click="emit('reset')"
          >
            重置
          </button>
          <button class="primary-button" type="submit" :disabled="loading || hasErrors">
            <span>{{ loading ? '匹配中' : '获取我的推荐' }}</span>
            <b>{{ loading ? '···' : '↗' }}</b>
          </button>
        </div>
      </div>
    </form>
  </section>
</template>

<style scoped>
.planner {
  margin-top: -32px;
  padding: 30px 34px 26px;
  position: relative;
  z-index: 2;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--card);
  box-shadow: 0 18px 45px rgba(19, 61, 49, 0.08);
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.section-kicker {
  margin: 0;
  color: var(--orange-ink);
  font-size: var(--fs-micro);
  font-weight: 700;
  letter-spacing: 0.18em;
}
.section-heading h2 {
  margin: 5px 0 0;
  font-size: var(--fs-lg);
  letter-spacing: -0.04em;
}
.channel-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 11px;
  border: 1px solid var(--line);
  border-radius: 20px;
  color: var(--ink-soft);
  background: #fbfcfa;
  font-size: var(--fs-xs);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.channel-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7fc88f;
}
.channel-badge.degraded i {
  background: var(--orange);
}
.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1.45fr;
  gap: 18px;
  margin-top: 26px;
}
.field {
  display: block;
  color: var(--ink-soft);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.field > span {
  display: block;
  margin-bottom: 9px;
}
.input-wrap {
  display: flex;
  align-items: center;
  border: 1px solid var(--line);
  background: #fbfcfa;
  transition: border-color 0.2s ease;
}
.input-wrap:focus-within {
  border-color: var(--ink);
}
.input-wrap.invalid {
  border-color: var(--danger);
  background: #fff7f5;
}
.input-wrap b {
  padding-right: 13px;
  color: var(--muted);
  font-size: var(--fs-xs);
  font-weight: 500;
  white-space: nowrap;
}
.input-wrap input {
  width: 100%;
  min-height: 46px;
  padding: 10px 13px;
  border: 0;
  color: var(--ink);
  background: transparent;
  outline: 0;
  font-weight: 400;
}
.input-wrap input::placeholder {
  color: var(--muted-soft);
}
.field-tip,
.field-error {
  display: block;
  margin-top: 6px;
  font-size: var(--fs-xs);
  font-style: normal;
  font-weight: 500;
}
.field-tip {
  color: var(--muted-soft);
}
.field-error {
  color: var(--danger);
}
.preference-row {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 24px;
}
.field-label {
  color: var(--ink-soft);
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
}
.preference-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.preference-chip {
  min-height: 40px;
  padding: 0 18px;
  border: 1px solid var(--line);
  border-radius: 20px;
  color: var(--ink-soft);
  background: #fff;
  font-size: var(--fs-sm);
  transition: 0.2s ease;
}
.preference-chip:hover {
  border-color: var(--ink);
  transform: translateY(-1px);
}
.preference-chip.active {
  border-color: var(--ink);
  color: var(--ink);
  background: var(--lime);
  font-weight: 700;
}
.preference-error {
  margin-top: 10px;
}
/* 流式推送进度条 */
.stream-progress {
  height: 3px;
  margin-top: 22px;
  overflow: hidden;
  background: #e9efea;
}
.stream-progress-bar {
  height: 100%;
  background: var(--ink);
  transition: width 0.25s ease;
}
.stream-progress-bar.indeterminate {
  width: 35%;
  animation: stream-slide 1.1s ease-in-out infinite;
}
@keyframes stream-slide {
  0% {
    margin-left: -35%;
  }
  100% {
    margin-left: 100%;
  }
}
.planner-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-top: 26px;
  padding-top: 22px;
  border-top: 1px solid #edf1ed;
}
.status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-sm);
}
.status-icon {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #eef4ed;
  font-size: var(--fs-xs);
}
.status-error {
  color: var(--danger);
}
.status-error .status-icon {
  color: #fff;
  background: #c0472a;
}
.status-success {
  color: var(--ink);
}
.status-success .status-icon {
  color: var(--ink);
  background: var(--lime);
}
.status-loading .status-icon {
  animation: spin 1.1s linear infinite;
}
.planner-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ghost-button {
  min-height: 48px;
  padding: 0 20px;
  border: 1px solid var(--line);
  border-radius: 2px;
  color: var(--ink-soft);
  background: #fff;
  font-size: var(--fs-sm);
  transition: 0.2s ease;
}
.ghost-button:hover:not(:disabled) {
  border-color: var(--ink);
  color: var(--ink);
}
.ghost-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary-button {
  display: inline-flex;
  align-items: center;
  gap: 18px;
  min-height: 48px;
  padding: 0 22px;
  border: 0;
  border-radius: 2px;
  color: #f8fbf5;
  background: var(--ink);
  font-size: var(--fs-base);
  font-weight: 600;
  transition: 0.22s ease;
}
.primary-button b {
  color: var(--lime);
  font-size: var(--fs-base);
}
.primary-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px rgba(19, 61, 49, 0.22);
}
.primary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 820px) {
  .field-grid {
    grid-template-columns: 1fr 1fr;
  }
  .allergy-field {
    grid-column: 1 / -1;
  }
}
@media (max-width: 620px) {
  .planner {
    margin-top: -18px;
    padding: 24px 18px 20px;
  }
  .section-heading {
    flex-wrap: wrap;
  }
  .section-heading h2 {
    font-size: var(--fs-lg);
  }
  .field-grid {
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 22px;
  }
  .preference-row {
    display: block;
    margin-top: 22px;
  }
  .preference-list {
    margin-top: 10px;
  }
  /* 移动端加大触控目标，满足 44px 最小点击区 */
  .preference-chip {
    min-height: 44px;
    padding: 0 20px;
  }
  .planner-footer {
    display: block;
  }
  .planner-actions {
    margin-top: 16px;
  }
  .ghost-button,
  .primary-button {
    flex: 1;
    justify-content: center;
  }
  .primary-button {
    justify-content: space-between;
  }
}
</style>
