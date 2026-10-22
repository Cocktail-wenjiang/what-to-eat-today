<script>
export default {
	onLaunch: function () {
		// uniCloud 初始化
		// - H5 端：由 uni-app 编译器自动注入当前关联的云空间，无需 init
		// - 小程序 / App 端：需要显式 init 并指定 spaceId
		// #ifndef H5
		if (typeof uniCloud !== 'undefined' && uniCloud) {
			uniCloud.init({
				provider: 'aliyun',
				spaceId: 'mp-67cd4ac5-6d7a-4db2-b4f2-5b114b2ead32',
				clientSecret: ''
			})
		}
		// #endif
	}
}
</script>

<style>
/* 每个页面公共样式 */
page {
	background-color: #f1ead9;
	color: #342d24;
	font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
	line-height: 1.5;
	-webkit-font-smoothing: antialiased;
	--archive-paper: #f1ead9;
	--archive-paper-deep: #e7ddc9;
	--archive-card: #fffaf0;
	--archive-ink: #342d24;
	--archive-soft: #766d60;
	--archive-muted: #9b917f;
	--archive-olive: #81905e;
	--archive-olive-soft: #e6ead7;
	--archive-tomato: #a54532;
	--archive-tomato-soft: #f4e0d9;
	--archive-line: #c9bda8;
	--archive-line-soft: rgba(111, 94, 70, .18);
	--archive-shadow: 0 16rpx 36rpx rgba(77, 56, 31, .09);
	/* 旧组件令牌暂时映射到同一套档案颜色，防止跨端编译出现未定义值。 */
	--apple-bg: var(--archive-paper);
	--apple-surface: var(--archive-card);
	--apple-surface-soft: rgba(255, 250, 240, .78);
	--apple-ink: var(--archive-ink);
	--apple-ink-soft: var(--archive-soft);
	--apple-muted: var(--archive-muted);
	--apple-line: var(--archive-line);
	--apple-line-soft: var(--archive-line-soft);
	--apple-blue: var(--archive-olive);
	--apple-blue-soft: var(--archive-olive-soft);
	--apple-green: var(--archive-olive);
	--apple-orange: var(--archive-tomato);
	--apple-red: var(--archive-tomato);
	--apple-shadow: var(--archive-shadow);
	--space-bg: var(--archive-paper);
	--space-panel: var(--archive-card);
	--space-panel-strong: var(--archive-card);
	--space-line: var(--archive-line);
	--space-line-strong: var(--archive-line);
	--space-text: var(--archive-ink);
	--space-text-soft: var(--archive-soft);
	--space-muted: var(--archive-muted);
	--space-cyan: var(--archive-olive);
	--space-blue: var(--archive-olive);
	--space-orange: var(--archive-tomato);
	--space-danger: var(--archive-tomato);
}

/* uni-app 默认 button 有自带边框与内阴影，这里统一抹平，样式由各组件自行控制 */
button {
	line-height: normal;
}

button::after {
	border: none;
}

/* 档案主题的跨组件护栏：旧组件样式也必须落回同一张纸上。 */
.app-shell, .qa-shell { background: var(--archive-paper) !important; color: var(--archive-ink) !important; }
.topbar, .qa-topbar { background: rgba(241, 234, 217, .94) !important; border-color: var(--archive-line-soft) !important; backdrop-filter: none !important; }
.brand-mark { background: var(--archive-olive) !important; color: #fffaf0 !important; box-shadow: none !important; }
.brand-name, .qa-title, .section-title, .history-title, .ask-entry-title, .recipe-name, .detail-title, .block-title, .empty-title, .ai-head-title { color: var(--archive-ink) !important; }
.brand-sub, .topbar-note, .result-meta, .filtered-text, .ask-entry-desc, .footer text, .history-count, .history-state, .history-mode, .history-result, .recipe-time, .ingredients, .score-unit, .step-item, .metric-label, .step-text, .qa-empty-hint { color: var(--archive-soft) !important; }
.section-kicker, .history-kicker, .ask-entry-kicker, .qa-kicker, .detail-kicker, .ai-kicker, .eyebrow { color: var(--archive-tomato) !important; }
.hero, .planner, .history-panel, .ask-entry, .empty-state, .recipe-card, .filtered-empty, .ai-notice, .qa-sample, .detail-panel, .ai-panel { border-color: var(--archive-line-soft) !important; background: var(--archive-card) !important; box-shadow: var(--archive-shadow) !important; backdrop-filter: none !important; }
.hero::before, .hero::after, .hero-visual::before { display: none !important; }
.hero { display: flex !important; flex-direction: column !important; min-height: 0 !important; padding: 0 !important; overflow: hidden !important; border-radius: 4rpx !important; }
.hero-backdrop { position: relative !important; order: 2 !important; inset: auto !important; width: 100% !important; height: 330rpx !important; opacity: 1 !important; transform: none !important; filter: saturate(.92) !important; object-fit: cover !important; }
.hero-copy { order: 1 !important; min-height: 0 !important; padding: 34rpx 32rpx 30rpx !important; color: var(--archive-ink) !important; }
.hero-meta, .hero-title, .hero-stats { position: relative !important; z-index: 1 !important; }
.hero-meta { color: var(--archive-soft) !important; }
.hero-title { margin-top: 38rpx !important; color: var(--archive-ink) !important; font: 600 54rpx/1.18 'Songti SC', 'Noto Serif CJK SC', serif !important; letter-spacing: 0 !important; text-shadow: none !important; }
.hero-em { color: var(--archive-tomato) !important; }
.hero-lede { color: var(--archive-soft) !important; }
.hero-stats { border-top-color: var(--archive-line-soft) !important; }
.stat-num { color: var(--archive-ink) !important; }
.hero-visual { display: none !important; }
.hero-primary-arrow { color: #fffaf0 !important; }
.ai-notice { border-left-color: var(--archive-olive) !important; }
.recipe-card { border-radius: 2rpx !important; }
.recipe-cover, .detail-cover { border-radius: 2rpx !important; }
.ai-overlay { background: rgba(52, 45, 36, .28) !important; backdrop-filter: none !important; }
.ai-panel { border-radius: 4rpx 4rpx 0 0 !important; }
.ai-bubble-user, .qa-bubble-user { background: var(--archive-tomato) !important; border-color: var(--archive-tomato) !important; }
.ai-bubble-ai, .qa-bubble-ai { background: var(--archive-paper) !important; border-color: var(--archive-line) !important; }
.ai-empty-title, .ai-bubble-text, .qa-empty-title, .qa-bubble-text { color: var(--archive-ink) !important; }
.ai-empty-hint, .ai-typing-text, .qa-typing-text { color: var(--archive-soft) !important; }
.history-panel { border-radius: 2rpx !important; }
.detail-panel { border-radius: 4rpx 4rpx 0 0 !important; }
.detail-close { border-radius: 2rpx !important; }
.detail-ingredients .ingredient { border-radius: 2rpx !important; }
.tool-chip, .preference-chip, .tag, .fit-tag, .ingredient, .qa-composer-field, .ai-composer-field { border-color: var(--archive-line) !important; background: var(--archive-paper) !important; color: var(--archive-soft) !important; }
.tool-chip.active, .preference-chip.active { border-color: var(--archive-olive) !important; background: var(--archive-olive) !important; color: #fffaf0 !important; }
.hero-primary, .primary-button, .empty-action, .qa-send, .ai-send { background: var(--archive-tomato) !important; color: #fffaf0 !important; box-shadow: none !important; }
.hero-secondary, .ghost-button, .recipe-detail-btn, .history-replay, .history-toggle { border-color: var(--archive-line) !important; border-radius: 4rpx !important; color: var(--archive-ink) !important; background: transparent !important; }
.ask-entry-arrow, .detail-arrow, .step-no, .status-icon { background: var(--archive-olive-soft) !important; color: var(--archive-olive) !important; }
.mobile-tabbar { background: rgba(255, 250, 240, .98) !important; border-top-color: var(--archive-line-soft) !important; box-shadow: none !important; backdrop-filter: none !important; }
.tab-item { color: var(--archive-soft) !important; border-radius: 0 !important; }
.tab-active { color: var(--archive-tomato) !important; background: transparent !important; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>

