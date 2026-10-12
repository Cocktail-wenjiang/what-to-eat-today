<script setup>
/**
 * 菜谱卡片 —— 展示单条推荐结果
 * 卡片内展示概要，点击「查看做法」由父组件打开详情弹窗。
 */
import { padIndex } from '@/utils/format'

const props = defineProps({
  recipe: { type: Object, required: true },
  index: { type: Number, default: 0 },
})

const emit = defineEmits(['detail'])

/** 食材过多时折叠显示，避免卡片高度失控 */
const visibleIngredients = (recipe) => (recipe.ingredients || []).slice(0, 6)
const hiddenCount = (recipe) =>
  Math.max((recipe.ingredients || []).length - 6, 0)
</script>

<template>
  <article class="recipe-card" :class="'accent-' + ((index % 3) + 1)">
    <div class="recipe-topline">
      <span class="recipe-index">{{ padIndex(index) }}</span>
      <span class="recipe-time">◷ {{ recipe.minutes }} MIN</span>
    </div>

    <div class="recipe-main">
      <div class="recipe-info">
        <h3>{{ recipe.name }}</h3>
        <p class="ingredients">
          {{ visibleIngredients(recipe).join(' · ') }}
          <em v-if="hiddenCount(recipe)">等 {{ recipe.ingredients.length }} 种</em>
        </p>
        <div class="tag-list">
          <span v-for="tag in recipe.tags" :key="tag">{{ tag }}</span>
        </div>
      </div>
      <div class="recipe-score">
        <strong>{{ recipe.minutes }}</strong>
        <span>分钟上桌</span>
      </div>
    </div>

    <ol class="steps">
      <li v-for="(step, i) in (recipe.steps || []).slice(0, 2)" :key="i">{{ step }}</li>
    </ol>

    <button type="button" class="recipe-detail-btn" @click="emit('detail', recipe)">
      查看完整做法
      <b v-if="(recipe.steps || []).length">· {{ recipe.steps.length }} 步</b>
    </button>
  </article>
</template>

<style scoped>
.recipe-card {
  min-height: 300px;
  padding: 22px 21px 18px;
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-top: 4px solid var(--accent);
  background: var(--card);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}
.recipe-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 16px 30px rgba(19, 61, 49, 0.1);
}
.accent-1 {
  --accent: var(--orange);
  --accent-ink: #b8481f; /* 文字用深橙，对白底 5.3:1 */
}
.accent-2 {
  --accent: var(--blue);
  --accent-ink: #25708a; /* 文字用深青，对白底 5.2:1 */
}
.accent-3 {
  --accent: #b7d65e;
  --accent-ink: #4f6d17; /* 文字用深绿，对白底 5.6:1 */
}
.recipe-topline,
.recipe-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.recipe-index {
  color: var(--accent-ink);
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.14em;
}
.recipe-time {
  color: var(--muted);
  font-size: var(--fs-xs);
  letter-spacing: 0.08em;
}
.recipe-main {
  align-items: flex-end;
  margin-top: 26px;
}
.recipe-info h3 {
  margin: 0;
  font-size: var(--fs-lg);
  letter-spacing: -0.04em;
}
.ingredients {
  min-height: 21px;
  margin: 9px 0 0;
  color: var(--muted);
  font-size: var(--fs-sm);
}
.ingredients em {
  font-style: normal;
  color: var(--ink-soft);
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 15px;
}
.tag-list span {
  padding: 4px 9px;
  color: var(--ink-soft);
  background: #eef4ed;
  font-size: var(--fs-xs);
}
.recipe-score {
  min-width: 62px;
  padding-left: 12px;
  border-left: 1px solid var(--line);
  text-align: right;
}
.recipe-score strong {
  display: block;
  color: var(--accent-ink);
  font-size: 26px;
  line-height: 0.9;
}
.recipe-score span {
  display: block;
  margin-top: 7px;
  color: var(--muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
.steps {
  flex: 1;
  margin: 20px 0 0;
  padding: 15px 0 0 20px;
  border-top: 1px solid #edf1ed;
  color: var(--ink-soft);
  font-size: var(--fs-sm);
}
.steps li {
  margin: 7px 0;
  padding-left: 3px;
}
.steps li::marker {
  color: var(--accent-ink);
  font-weight: 700;
}
.recipe-detail-btn {
  margin-top: 16px;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 2px;
  color: var(--ink-soft);
  background: #fff;
  font-size: var(--fs-sm);
  text-align: left;
  transition: 0.2s ease;
}
.recipe-detail-btn b {
  color: var(--muted);
  font-weight: 500;
}
.recipe-detail-btn:hover {
  border-color: var(--ink);
  background: var(--lime);
  color: var(--ink);
}
.recipe-detail-btn:hover b {
  color: var(--ink);
}
</style>
