import time
from typing import Iterator

from .data import load_recipes, save_history


def _match_recipes(request: dict) -> list[dict]:
    """按人数/时间/偏好/忌口匹配菜谱，命中为空时回退到时间与忌口过滤。

    同步推荐与流式推荐共用该逻辑，保证两条链路结果一致。
    """
    allergy = (request.get("allergy") or "").strip()
    preference = request["preference"].strip()
    recipes = []
    for recipe in load_recipes():
        searchable = " ".join(recipe["ingredients"] + recipe["tags"])
        if recipe["minutes"] > request["max_minutes"]:
            continue
        if allergy and allergy in searchable:
            continue
        if preference not in recipe["tags"] and preference != "不限":
            continue
        recipes.append({**recipe, "source": "db"})
    if not recipes:
        recipes = [
            {**recipe, "source": "db"}
            for recipe in load_recipes()
            if recipe["minutes"] <= request["max_minutes"]
            and not (allergy and allergy in " ".join(recipe["ingredients"]))
        ][:3]
    return recipes[:3]


def recommend(request: dict) -> tuple[int, list[dict]]:
    """同步推荐：一次性返回落库 id 与推荐结果。"""
    recipes = _match_recipes(request)
    return save_history(request, recipes), recipes


def iter_recommendation_events(request: dict) -> Iterator[dict]:
    """流式推荐：按匹配过程逐步产出事件，供 SSE 逐帧推送。

    事件序列：start -> recipe(0..n) -> done
    """
    started = time.perf_counter()
    criteria = {
        "servings": request["servings"],
        "max_minutes": request["max_minutes"],
        "preference": request["preference"],
        "allergy": request.get("allergy") or "",
    }
    yield {
        "type": "start",
        "message": "开始匹配菜谱",
        "candidates": len(load_recipes()),
        "criteria": criteria,
    }

    recipes = _match_recipes(request)
    total = len(recipes)
    for index, recipe in enumerate(recipes, start=1):
        yield {"type": "recipe", "index": index, "total": total, "recipe": recipe}

    record_id = save_history(request, recipes)
    yield {
        "type": "done",
        "id": record_id,
        "count": total,
        "criteria": criteria,
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
        "recipes": [recipe["name"] for recipe in recipes],
    }
