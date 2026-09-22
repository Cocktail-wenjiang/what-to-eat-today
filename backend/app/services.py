from .data import load_recipes, save_history


def recommend(request: dict) -> tuple[int, list[dict]]:
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
    return save_history(request, recipes), recipes[:3]
