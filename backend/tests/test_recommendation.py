from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_recommendation_returns_matching_recipe_and_persists_history():
    response = client.post(
        "/api/recommend",
        json={"servings": 2, "max_minutes": 30, "preference": "清淡", "allergy": "花生"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["recommendations"]

    # 断言结果满足筛选条件，而非硬编码菜谱 ID：
    # 种子菜谱随迭代扩充（当前 110 条），硬编码 ID 会随数据变化失效。
    for recipe in body["recommendations"]:
        assert recipe["source"] == "db"
        assert recipe["minutes"] <= 30
        assert "清淡" in recipe["tags"]
        assert "花生" not in " ".join(recipe["ingredients"] + recipe["tags"])

    history = client.get("/api/recommendations/history")
    assert history.status_code == 200
    assert history.json()[0]["preference"] == "清淡"


def test_recommendation_rejects_invalid_input_with_actionable_error():
    response = client.post(
        "/api/recommend",
        json={"servings": 0, "max_minutes": 30, "preference": "清淡"},
    )

    assert response.status_code == 422
    assert "servings" in response.text
