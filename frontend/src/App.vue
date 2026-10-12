<script setup>
/**
 * App 根组件
 * 负责：页面骨架（顶栏 / Hero / 表单 / 结果 / 历史 / 页脚）
 *       结果区的筛选排序、空状态建议、以及把结果滚动到可视区。
 */
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRecommendation } from '@/composables/useRecommendation'
import PlannerForm from '@/components/PlannerForm.vue'
import RecipeCard from '@/components/RecipeCard.vue'
import RecipeDetail from '@/components/RecipeDetail.vue'
import HistoryPanel from '@/components/HistoryPanel.vue'
import ResultSkeleton from '@/components/ResultSkeleton.vue'
import EmptyState from '@/components/EmptyState.vue'
import { modeLabel } from '@/utils/format'
import { countStrictMatches } from '@/api/ruleEngine'

const {
  form,
  errors,
  results,
  history,
  historyChannel,
  loading,
  historyLoading,
  status,
  channel,
  channelLabel,
  degraded,
  errorMessage,
  usedMode,
  hasSubmitted,
  statusText,
  submit,
  loadHistory,
  replay,
  reset,
  validateField,
  choosePreference,
} = useRecommendation()

/** 当前打开详情的菜谱 */
const activeRecipe = ref(null)
const resultsRef = ref(null)

// ===== 结果区筛选与排序 =====
/** '' 表示不筛选 */
const activeTag = ref('')
const sortBy = ref('match') // match | minutes-asc | minutes-desc

/** 当前结果中出现过的全部标签 */
const availableTags = computed(() => {
  const set = new Set()
  results.value.forEach((r) => (r.tags || []).forEach((t) => set.add(t)))
  return Array.from(set)
})

/** 应用筛选与排序后的列表 */
const displayedResults = computed(() => {
  let list = results.value

  if (activeTag.value) {
    list = list.filter((r) => (r.tags || []).includes(activeTag.value))
  }

  const sorted = [...list]
  if (sortBy.value === 'minutes-asc') {
    sorted.sort((a, b) => a.minutes - b.minutes)
  } else if (sortBy.value === 'minutes-desc') {
    sorted.sort((a, b) => b.minutes - a.minutes)
  }
  return sorted
})

/** 筛选后为空但原本有结果时，提示用户 */
const filteredEmpty = computed(
  () => results.value.length > 0 && displayedResults.value.length === 0
)

function clearFilters() {
  activeTag.value = ''
  sortBy.value = 'match'
}

// ===== 空状态的可操作建议 =====
/**
 * 依次尝试放宽单个条件，统计各方案能严格命中多少条，
 * 只保留有命中的方案，按命中数降序，最多 3 条。
 *
 * 注意用 countStrictMatches 而非 recommendByRules：
 * 后者带降级兜底（软条件无命中时会放开口味），
 * 会让「口味改为不限」这类建议的增量被掩盖。
 */
const suggestions = computed(() => {
  if (status.value !== 'empty' || !hasSubmitted.value) return []

  const base = {
    servings: Number(form.servings),
    max_minutes: Number(form.max_minutes),
    preference: form.preference,
    allergy: form.allergy,
  }
  const pool = recipePool.value
  if (!pool.length) return []

  const candidates = []

  // 放宽用时到 60 分钟
  if (base.max_minutes < 60) {
    const count = countStrictMatches(pool, { ...base, max_minutes: 60 })
    if (count) {
      candidates.push({
        label: '把用时放宽到 60 分钟',
        count,
        patch: { max_minutes: 60 },
      })
    }
  }

  // 口味改为不限
  if (base.preference !== '不限') {
    const count = countStrictMatches(pool, { ...base, preference: '不限' })
    if (count) {
      candidates.push({
        label: '口味改为「不限」',
        count,
        patch: { preference: '不限' },
      })
    }
  }

  // 去掉忌口
  if (base.allergy) {
    const count = countStrictMatches(pool, { ...base, allergy: '' })
    if (count) {
      candidates.push({
        label: `去掉忌口「${base.allergy}」`,
        count,
        patch: { allergy: '' },
      })
    }
  }

  // 用时过紧时，同时放宽用时+口味往往才是真正可行的方案
  if (base.max_minutes < 60 && base.preference !== '不限') {
    const count = countStrictMatches(pool, {
      ...base,
      max_minutes: 60,
      preference: '不限',
    })
    if (count) {
      const already = candidates.some((c) => c.count === count)
      if (!already) {
        candidates.push({
          label: '用时放宽到 60 分钟 + 口味不限',
          count,
          patch: { max_minutes: 60, preference: '不限' },
        })
      }
    }
  }

  return candidates.sort((a, b) => b.count - a.count).slice(0, 3)
})

/** 读取随前端一起发布的本地种子菜谱（离线兜底） */
async function loadLocalSeedPool() {
  try {
    const res = await fetch('/data/recipes.json')
    return res.ok ? await res.json() : []
  } catch {
    return []
  }
}

/**
 * 菜谱池缓存（供建议计算与 Hero 数字用），首次需要时加载。
 * 数据来源：随前端一起发布的本地种子菜谱（离线兜底）。
 * 之所以必须要有本地兜底：后端/网络不可达时若不回退，
 * 建议列表会静默退化为无效的「放宽条件重新推荐」按钮。
 */
const recipePool = ref([])
async function ensureRecipePool() {
  if (recipePool.value.length) return
  recipePool.value = await loadLocalSeedPool()
}

/** Hero 展示的菜谱总数，未加载完成时显示占位 */
const recipeCount = computed(() =>
  recipePool.value.length ? String(recipePool.value.length) : '—'
)

onMounted(() => ensureRecipePool())

/** 应用某条放宽建议并重新推荐 */
async function applySuggestion(patch) {
  Object.assign(form, patch)
  await handleSubmit()
}

function openDetail(recipe) {
  activeRecipe.value = recipe
}
function closeDetail() {
  activeRecipe.value = null
}

/** 提交后滚动到结果区，让用户立刻看到反馈 */
async function handleSubmit() {
  activeTag.value = ''
  sortBy.value = 'match'
  await submit()
  if (status.value === 'success' || status.value === 'empty') {
    await nextTick()
    resultsRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

/** 空状态里的通用「放宽条件」：用时 +30 分钟、口味不限 */
async function relaxAndRetry() {
  form.max_minutes = Math.min(60, Number(form.max_minutes) + 30)
  form.preference = '不限'
  await handleSubmit()
}

watch(status, (value) => {
  if (value === 'empty') ensureRecipePool()
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#top" aria-label="今天吃什么首页">
        <span class="brand-mark">E</span>
        <span><strong>eat well</strong><small>今天吃什么</small></span>
      </a>
      <div class="topbar-meta">
        <span class="pulse-dot" :class="{ offline: degraded }"></span>
        数据通道
        <b>{{ channelLabel }}</b>
        <button
          class="mode-toggle"
          type="button"
          title="重新检测数据通道并刷新历史"
          @click="loadHistory"
        >
          ⟳
        </button>
      </div>
    </header>

    <main id="top" class="page-wrap">
      <!-- ===== 首屏 ===== -->
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p class="eyebrow">SMART MEAL PLANNER <span></span> 01</p>
          <h1 id="hero-title">今天，吃得<br /><em>更好一点。</em></h1>
          <p class="hero-lede">
            把人数、时间和忌口交给我们，<br />用一顿真正适合你的饭开启今天。
          </p>
          <div class="hero-stats" aria-label="服务特点">
            <div><strong>{{ recipeCount }}</strong><span>道可做菜谱</span></div>
            <div><strong>30<span>min</span></strong><span>最快上桌</span></div>
            <div><strong>3<span>类</span></strong><span>忌口可筛选</span></div>
          </div>
        </div>
        <div class="hero-orbit" aria-hidden="true">
          <div class="orbit-ring ring-one"></div>
          <div class="orbit-ring ring-two"></div>
          <div class="orbit-core"><span>今日<br />能量</span><b>↗</b></div>
          <span class="orbit-label label-a">轻松开始</span>
          <span class="orbit-label label-b">真实可做</span>
        </div>
      </section>

      <!-- ===== 需求表单 ===== -->
      <PlannerForm
        :form="form"
        :errors="errors"
        :loading="loading"
        :status-text="statusText"
        :channel-label="channelLabel"
        :degraded="degraded"
        :status="status"
        @submit="handleSubmit"
        @reset="reset"
        @validate="validateField"
        @choose-preference="choosePreference"
      />

      <!-- ===== 结果区 ===== -->
      <section
        ref="resultsRef"
        class="results-section"
        aria-labelledby="results-title"
        aria-live="polite"
        :aria-busy="status === 'loading'"
      >
        <div class="results-heading">
          <div>
            <p class="section-kicker">YOUR PICKS</p>
            <h2 id="results-title">为你准备的菜单</h2>
          </div>

          <div v-if="results.length" class="result-tools">
            <span class="result-meta">
              {{ displayedResults.length }} / {{ results.length }} 道 ·
              {{ modeLabel(usedMode) }}
            </span>
            <select v-model="sortBy" class="tool-select" aria-label="排序方式">
              <option value="match">按匹配度</option>
              <option value="minutes-asc">用时从短到长</option>
              <option value="minutes-desc">用时从长到短</option>
            </select>
            <button
              v-for="tag in availableTags"
              :key="tag"
              type="button"
              :class="['tool-chip', { active: activeTag === tag }]"
              :aria-pressed="activeTag === tag"
              @click="activeTag = activeTag === tag ? '' : tag"
            >
              {{ tag }}
            </button>
            <button
              v-if="activeTag || sortBy !== 'match'"
              type="button"
              class="tool-clear"
              @click="clearFilters"
            >
              清除
            </button>
          </div>
        </div>

        <ResultSkeleton v-if="status === 'loading'" />

        <EmptyState v-else-if="status === 'error'" :has-searched="false" />

        <EmptyState
          v-else-if="!results.length"
          :has-searched="hasSubmitted"
          :reason="errorMessage"
          :suggestions="suggestions"
          @retry="relaxAndRetry"
          @apply="applySuggestion"
        />

        <div v-else-if="filteredEmpty" class="filtered-empty">
          <p>当前筛选「{{ activeTag }}」下没有菜谱。</p>
          <button type="button" class="empty-action" @click="clearFilters">
            清除筛选
          </button>
        </div>

        <div v-else class="recipe-list">
          <RecipeCard
            v-for="(recipe, index) in displayedResults"
            :key="recipe.recipeId || index"
            :recipe="recipe"
            :index="index"
            @detail="openDetail"
          />
        </div>
      </section>

      <!-- ===== 历史记录 ===== -->
      <HistoryPanel
        :items="history"
        :loading="historyLoading"
        :channel="historyChannel"
        @replay="replay"
      />
    </main>

    <footer class="footer">
      <span>eat well / make a better meal</span>
      <span>Vue 3 · FastAPI 后端 + 本地规则兜底 · 数据可追溯</span>
    </footer>

    <RecipeDetail :recipe="activeRecipe" @close="closeDetail" />
  </div>
</template>

<style scoped>
.topbar-meta {
  display: flex;
  align-items: center;
}
.pulse-dot.offline {
  background: var(--orange);
  box-shadow: 0 0 0 4px rgba(255, 128, 91, 0.16);
}
.mode-toggle {
  margin-left: 10px;
  width: 36px;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 50%;
  color: var(--ink-soft);
  background: #fff;
  font-size: var(--fs-sm);
  transition: 0.2s ease;
}
.mode-toggle:hover {
  border-color: var(--ink);
  background: var(--lime);
}
.results-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.section-kicker {
  margin: 0;
  color: var(--orange-ink);
  font-size: var(--fs-micro);
  font-weight: 700;
  letter-spacing: 0.18em;
}
.results-heading h2 {
  margin: 5px 0 0;
  font-size: var(--fs-lg);
  letter-spacing: -0.04em;
}
.result-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: var(--fs-xs);
}
/* 筛选与排序控件 */
.result-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tool-select {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 2px;
  color: var(--ink-soft);
  background: #fff;
  font-size: var(--fs-xs);
}
.tool-chip {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 19px;
  color: var(--ink-soft);
  background: #fff;
  font-size: var(--fs-xs);
  transition: 0.2s ease;
}
.tool-chip:hover {
  border-color: var(--ink);
}
.tool-chip.active {
  border-color: var(--ink);
  background: var(--lime);
  color: var(--ink);
  font-weight: 700;
}
.tool-clear {
  min-height: 38px;
  padding: 0 12px;
  border: 1px dashed var(--line);
  border-radius: 2px;
  color: var(--muted);
  background: transparent;
  font-size: var(--fs-xs);
}
.tool-clear:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.recipe-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
}
/* 筛选后为空的提示 */
.filtered-empty {
  padding: 40px 20px;
  border: 1px dashed #cbd9d0;
  text-align: center;
}
.filtered-empty p {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: var(--fs-sm);
}
.filtered-empty .empty-action {
  min-height: 44px;
  padding: 0 22px;
  border: 1px solid var(--ink);
  border-radius: 2px;
  color: var(--ink);
  background: var(--lime);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.results-section {
  margin-top: 62px;
  scroll-margin-top: 20px;
}
@media (max-width: 820px) {
  .recipe-list {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 620px) {
  .recipe-list {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .results-section {
    margin-top: 48px;
  }
  .results-heading h2 {
    font-size: var(--fs-lg);
  }
  .result-meta {
    display: none;
  }
  .results-heading {
    align-items: flex-start;
  }
  .result-tools {
    width: 100%;
  }
  .tool-select,
  .tool-chip,
  .tool-clear {
    min-height: 44px;
  }
  .topbar-meta {
    font-size: 0;
  }
  .topbar-meta b {
    display: none;
  }
  .mode-toggle {
    width: 44px;
    height: 44px;
  }
}
</style>
