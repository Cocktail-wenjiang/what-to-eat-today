/**
 * 工具 Schema 与参数校验
 *
 * 两层用途，同一份定义：
 *  1) 交给模型：OpenAI 兼容接口的 `tools` 字段，让模型知道有哪些工具、参数怎么填；
 *  2) 交给程序：工具真正执行前，用 validateArgs() 按同一份定义再校验一次。
 *
 * **模型给的参数一律视为不可信输入。** 模型能读懂 schema，不代表它一定照做，
 * 更不代表它不会在参数里塞 `../`、超范围数值或未定义字段。所以第 2 层不是冗余。
 */

/** 与 static/data/recipes.json 中实际出现的标签集合一致（24 个，按频次排序） */
export const TAG_ENUM = [
	'无乳', '高蛋白', '下饭', '素食', '清淡', '软食', '纯素', '快捷',
	'无麸质', '减脂', '早餐', '无辣', '无骨', '汤', '无糖', '凉菜',
	'低GI', '清真友好', '低脂', '甜点', '烘焙', '西式', '无刺', '蛋奶素'
]

/** 工具定义：既用于生成 tools 字段，也用于执行前校验 */
export const TOOL_DEFS = [
	{
		name: 'search_recipes',
		description:
			'按用时上限与标签筛选菜谱，返回候选清单（含 recipeId、菜名、用时、标签）。这是获取候选菜的唯一入口。',
		parameters: {
			type: 'object',
			properties: {
				max_minutes: {
					type: 'integer',
					minimum: 5,
					maximum: 180,
					description: '用时上限（分钟），库内菜品用时区间为 5~120'
				},
				tags: {
					type: 'array',
					items: { type: 'string', enum: TAG_ENUM },
					maxItems: 2,
					description: '需要同时满足的标签，最多 2 个；不传表示不限'
				},
				exclude_allergy: {
					type: 'string',
					maxLength: 10,
					description: '需要避开的食材关键词，例如「虾」「花生」；命中菜名或食材即排除'
				},
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: 8,
					description: '返回条数上限，默认 3'
				}
			},
			required: ['max_minutes'],
			additionalProperties: false
		}
	},
	{
		name: 'recipe_detail',
		description: '按 recipeId 读取一道菜的完整信息：食材、步骤、标签、用时。recipeId 必须来自 search_recipes 的结果。',
		parameters: {
			type: 'object',
			properties: {
				recipeId: {
					type: 'string',
					pattern: '^R-[0-9]{3}$',
					description: '菜谱编号，形如 R-001'
				}
			},
			required: ['recipeId'],
			additionalProperties: false
		}
	},
	{
		name: 'calc_stats',
		description: '对一组菜谱做统计计算：道数、总用时、平均用时、最长用时、去重食材数、标签分布。只做算术，不返回菜品内容。',
		parameters: {
			type: 'object',
			properties: {
				recipeIds: {
					type: 'array',
					items: { type: 'string', pattern: '^R-[0-9]{3}$' },
					minItems: 1,
					maxItems: 8,
					description: '参与统计的菜谱编号数组'
				}
			},
			required: ['recipeIds'],
			additionalProperties: false
		}
	},
	{
		name: 'save_menu',
		description:
			'把最终菜单写入本地文件（会修改磁盘数据，执行前需要用户确认）。同一 menuId 重复写入会覆盖同一份文件。',
		parameters: {
			type: 'object',
			properties: {
				menuId: {
					type: 'string',
					pattern: '^[a-z0-9][a-z0-9-]{2,31}$',
					description: '菜单标识，小写字母/数字/连字符，3~32 位，用作文件名'
				},
				title: { type: 'string', minLength: 2, maxLength: 30, description: '菜单标题' },
				recipeIds: {
					type: 'array',
					items: { type: 'string', pattern: '^R-[0-9]{3}$' },
					minItems: 1,
					maxItems: 8,
					description: '菜单包含的菜谱编号'
				}
			},
			required: ['menuId', 'title', 'recipeIds'],
			additionalProperties: false
		}
	}
]

/** 按名称取工具定义 */
export function getToolDef(name) {
	return TOOL_DEFS.find((d) => d.name === name) || null
}

/** 转成 OpenAI 兼容接口要求的 tools 结构 */
export function toOpenAITools(defs = TOOL_DEFS) {
	return defs.map((d) => ({
		type: 'function',
		function: { name: d.name, description: d.description, parameters: d.parameters }
	}))
}

/**
 * 供提示词使用的工具清单（JSON 协议回退路径用）。
 * 原生 tools 不可用时，模型只能靠文字知道有哪些工具，所以要把 schema 一并写进提示词。
 */
export function describeToolsForPrompt(defs = TOOL_DEFS) {
	return defs
		.map((d) => {
			const props = d.parameters.properties || {}
			const required = new Set(d.parameters.required || [])
			const fields = Object.entries(props)
				.map(([key, spec]) => {
					const bits = [`类型=${spec.type}`]
					if (required.has(key)) bits.push('必填')
					if (spec.enum) bits.push(`取值∈[${spec.enum.join('/')}]`)
					if (spec.minimum !== undefined) bits.push(`最小=${spec.minimum}`)
					if (spec.maximum !== undefined) bits.push(`最大=${spec.maximum}`)
					if (spec.pattern) bits.push(`格式=${spec.pattern}`)
					if (spec.maxItems !== undefined) bits.push(`最多${spec.maxItems}项`)
					return `    - ${key}（${bits.join('，')}）${spec.description || ''}`
				})
				.join('\n')
			return `- ${d.name}：${d.description}\n${fields}`
		})
		.join('\n')
}

/**
 * 参数校验。
 * 返回 `{ ok:true, value }` 或 `{ ok:false, errors:[...] }`。
 * 错误信息写成「哪个字段、错在哪、允许什么」，因为它的消费者是模型——
 * 只说「参数非法」模型没法改，说清原因它下一轮就能改对。
 */
export function validateArgs(def, args) {
	const errors = []
	const spec = def.parameters
	const value = {}

	if (args === null || typeof args !== 'object' || Array.isArray(args)) {
		return { ok: false, errors: [`参数必须是一个 JSON 对象，实际收到 ${typeName(args)}`] }
	}

	// 未定义字段直接拒绝：模型偶尔会自己加「备注」「reason」这类字段，
	// 放行等于让未校验的数据进入执行层。
	if (spec.additionalProperties === false) {
		for (const key of Object.keys(args)) {
			if (!(key in (spec.properties || {}))) {
				errors.push(`不允许的参数 ${key}（${def.name} 只接受 ${Object.keys(spec.properties || {}).join('、')}）`)
			}
		}
	}

	for (const key of spec.required || []) {
		if (args[key] === undefined || args[key] === null || args[key] === '') {
			errors.push(`缺少必填参数 ${key}`)
		}
	}

	for (const [key, propSpec] of Object.entries(spec.properties || {})) {
		const raw = args[key]
		if (raw === undefined || raw === null) continue
		const r = checkValue(key, raw, propSpec)
		if (r.error) errors.push(r.error)
		else value[key] = r.value
	}

	// 补默认值：limit 有默认，其余缺省即不传
	if (def.name === 'search_recipes' && value.limit === undefined) value.limit = 3

	if (errors.length) return { ok: false, errors }
	return { ok: true, value }
}

function checkValue(key, raw, spec) {
	if (spec.type === 'integer') {
		if (typeof raw !== 'number' || !Number.isInteger(raw)) {
			return { error: `参数 ${key} 应为整数，实际为 ${typeName(raw)}（${JSON.stringify(raw)}）` }
		}
		if (spec.minimum !== undefined && raw < spec.minimum) {
			return { error: `参数 ${key} 不能小于 ${spec.minimum}，实际为 ${raw}` }
		}
		if (spec.maximum !== undefined && raw > spec.maximum) {
			return { error: `参数 ${key} 不能大于 ${spec.maximum}，实际为 ${raw}` }
		}
		return { value: raw }
	}

	if (spec.type === 'string') {
		if (typeof raw !== 'string') {
			return { error: `参数 ${key} 应为字符串，实际为 ${typeName(raw)}` }
		}
		const s = raw.trim()
		if (spec.minLength !== undefined && s.length < spec.minLength) {
			return { error: `参数 ${key} 长度不能小于 ${spec.minLength}` }
		}
		if (spec.maxLength !== undefined && s.length > spec.maxLength) {
			return { error: `参数 ${key} 长度不能超过 ${spec.maxLength}，实际 ${s.length}` }
		}
		if (spec.pattern && !new RegExp(spec.pattern).test(s)) {
			return { error: `参数 ${key} 格式不符（应匹配 ${spec.pattern}），实际为 "${s}"` }
		}
		if (spec.enum && !spec.enum.includes(s)) {
			return { error: `参数 ${key} 取值 "${s}" 不在允许列表内（${spec.enum.join('/')}）` }
		}
		return { value: s }
	}

	if (spec.type === 'array') {
		if (!Array.isArray(raw)) {
			return { error: `参数 ${key} 应为数组，实际为 ${typeName(raw)}` }
		}
		if (spec.minItems !== undefined && raw.length < spec.minItems) {
			return { error: `参数 ${key} 至少需要 ${spec.minItems} 项，实际 ${raw.length} 项` }
		}
		if (spec.maxItems !== undefined && raw.length > spec.maxItems) {
			return { error: `参数 ${key} 最多 ${spec.maxItems} 项，实际 ${raw.length} 项` }
		}
		const out = []
		for (let i = 0; i < raw.length; i += 1) {
			const item = checkValue(`${key}[${i}]`, raw[i], spec.items || { type: 'string' })
			if (item.error) return { error: item.error }
			out.push(item.value)
		}
		return { value: out }
	}

	return { value: raw }
}

function typeName(v) {
	if (v === null) return 'null'
	if (Array.isArray(v)) return 'array'
	return typeof v
}
