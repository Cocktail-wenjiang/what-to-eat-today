import { createApp, ref } from 'vue'
import './style.css'

const API = 'http://127.0.0.1:8000'
const App = {
  setup() {
    const form = ref({ servings: 2, max_minutes: 30, preference: '清淡', allergy: '' })
    const results = ref([])
    const message = ref('输入需求后获取推荐')
    async function submit() {
      message.value = '正在匹配菜谱...'
      const response = await fetch(`${API}/api/recommend`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(form.value) })
      if (!response.ok) { message.value = '输入有误，请检查人数和时间'; return }
      const body = await response.json(); results.value = body.recommendations; message.value = `已找到 ${results.value.length} 道可执行菜谱`
    }
    return { form, results, message, submit }
  },
  template: `<main><header><p class="eyebrow">WHAT TO EAT TODAY</p><h1>今天吃什么</h1><p>用真实可执行的菜谱，帮你快速决定下一餐。</p></header><section class="panel"><h2>告诉我你的需求</h2><div class="grid"><label>人数<input type="number" v-model.number="form.servings" min="1" max="20"></label><label>最多用时<input type="number" v-model.number="form.max_minutes" min="5" max="240"></label><label>偏好<select v-model="form.preference"><option>清淡</option><option>高蛋白</option><option>素食</option><option>不限</option></select></label><label>忌口<input v-model="form.allergy" placeholder="例如：花生"></label></div><button @click="submit">获取推荐</button><p class="status">{{ message }}</p></section><section class="results"><article v-for="recipe in results" :key="recipe.recipeId" class="recipe"><div><span class="tag">{{ recipe.minutes }} 分钟</span><h3>{{ recipe.name }}</h3><p>{{ recipe.ingredients.join('、') }}</p></div><ol><li v-for="step in recipe.steps" :key="step">{{ step }}</li></ol></article></section></main>`
}
createApp(App).mount('#app')
