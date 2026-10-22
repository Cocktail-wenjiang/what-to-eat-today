'use strict';

/**
 * 推荐云函数（uniCloud）
 *
 * 与原有实现保持完全一致的推荐语义：
 *   - max_minutes 为硬性上限（菜谱用时必须 <= 上限）
 *   - allergy 为硬性排除（对 ingredients + tags 做子串匹配）
 *   - preference 为软性条件；若无命中则放宽口味兜底（mode = rule-fallback）
 *
 * 入参（event）：
 *   servings     用餐人数 1~20
 *   max_minutes  最大用时 5~240
 *   preference   口味偏好 1~30 字
 *   allergy      忌口食材，可空
 *
 * 返回：
 *   { id, recommendations: [...], mode, database }
 *   recommendations 每条含 reason（生活化推荐理由）与 fitTags（本次命中的短标签），
 *   两者同源，均由 buildFitTags() 派生，供卡片展示。
 */

const COLLECTION_RECIPES = 'recipes';
const COLLECTION_HISTORY = 'recommendation_history';
const MAX_RESULTS = 3;

// ---------- 校验 ----------
function validate(event) {
    const errors = [];
    const servings = Number(event.servings);
    const maxMinutes = Number(event.max_minutes);
    const preference = String(event.preference == null ? '' : event.preference).trim();
    const allergy = String(event.allergy == null ? '' : event.allergy).trim();

    if (!Number.isInteger(servings) || servings < 1 || servings > 20) {
        errors.push({ field: 'servings', msg: '用餐人数需为 1~20 的整数' });
    }
    if (!Number.isInteger(maxMinutes) || maxMinutes < 5 || maxMinutes > 240) {
        errors.push({ field: 'max_minutes', msg: '最大用时需为 5~240 的整数' });
    }
    if (preference.length < 1 || preference.length > 30) {
        errors.push({ field: 'preference', msg: '口味偏好长度需为 1~30 字' });
    }
    if (allergy.length > 30) {
        errors.push({ field: 'allergy', msg: '忌口食材不超过 30 字' });
    }

    return { errors, value: { servings, maxMinutes, preference, allergy } };
}

// ---------- 规则推荐 ----------
function pick(recipes, { maxMinutes, preference, allergy }) {
    const matches = [];
    for (const recipe of recipes) {
        const tags = recipe.tags || [];
        const ingredients = recipe.ingredients || [];
        const searchable = ingredients.concat(tags).join(' ');

        if (Number(recipe.minutes) > maxMinutes) continue;
        if (allergy && searchable.indexOf(allergy) !== -1) continue;
        if (preference !== '不限' && tags.indexOf(preference) === -1) continue;

        matches.push(recipe);
    }
    return matches;
}

function pickFallback(recipes, { maxMinutes, allergy }) {
    const out = [];
    for (const recipe of recipes) {
        const ingredients = recipe.ingredients || [];
        if (Number(recipe.minutes) > maxMinutes) continue;
        if (allergy && ingredients.join(' ').indexOf(allergy) !== -1) continue;
        out.push(recipe);
        if (out.length >= MAX_RESULTS) break;
    }
    return out;
}

/** 统一裁剪成前端需要的字段 */
function toResult(recipe) {
    return {
        recipeId: recipe._id,
        name: recipe.name,
        ingredients: recipe.ingredients || [],
        steps: recipe.steps || [],
        minutes: recipe.minutes,
        tags: recipe.tags || [],
        // 菜品图路径（/static/images/recipes/R-0XX.jpg），由数据源透传
        image: recipe.image || '',
        fitTags: [],
        reason: '',
        source: 'db'
    };
}

/**
 * 本次匹配命中的短标签（卡片上的小徽标）。
 * 与 buildReason 同源：标签是理由的拆解，避免「徽标」与「文案」互相矛盾。
 */
function buildFitTags(recipe, value) {
    const fit = [];
    const minutes = Number(recipe.minutes);
    if (Number.isFinite(minutes) && minutes <= value.maxMinutes) fit.push(`${minutes}分钟内`);
    if (value.preference !== '不限' && (recipe.tags || []).includes(value.preference)) {
        fit.push(value.preference);
    }
    if (value.allergy) fit.push(`无${value.allergy}`);
    return fit;
}

function buildReason(recipe, value) {
    const fit = buildFitTags(recipe, value);
    return fit.length ? `适合这次安排：${fit.join('，')}。` : '这道菜步骤简单，适合按现在的时间安排。';
}

exports.main = async (event) => {
    const { errors, value } = validate(event);
    if (errors.length) {
        return { error: '参数校验失败', details: errors };
    }

    const db = uniCloud.database();
    const coll = db.collection(COLLECTION_RECIPES);

    // uniCloud 单次查询默认上限 100，菜谱量已超过，需分批取全量
    const COUNT = await coll.count();
    const total = (COUNT && COUNT.total) || 0;
    const LIMIT = 100;
    const recipes = [];
    for (let skip = 0; skip < total; skip += LIMIT) {
        const res = await coll.skip(skip).limit(LIMIT).get();
        recipes.push(...(res.data || []));
    }

    let mode = 'recommend-cloud';
    let picked = pick(recipes, value);

    if (!picked.length) {
        mode = 'rule-fallback';
        picked = pickFallback(recipes, value);
    }

    // 按用时升序，稳定的推荐顺序
    picked.sort((a, b) => Number(a.minutes) - Number(b.minutes) || String(a._id).localeCompare(String(b._id)));
    const results = picked.slice(0, MAX_RESULTS).map((recipe) => {
        const result = toResult(recipe);
        result.fitTags = buildFitTags(recipe, value);
        result.reason = buildReason(recipe, value);
        return result;
    });

    // 写入历史（失败不影响推荐结果）
    let historyId = null;
    try {
        const historyRes = await db.collection(COLLECTION_HISTORY).add({
            servings: value.servings,
            max_minutes: value.maxMinutes,
            preference: value.preference,
            allergy: value.allergy || '',
            recommendations: results,
            mode,
            created_at: Date.now()
        });
        historyId = historyRes.id || null;
    } catch (e) {
        console.error('写入推荐历史失败：', e && e.message);
    }

    return {
        id: historyId,
        recommendations: results,
        mode,
        database: 'uniCloud-aliyun'
    };
};
