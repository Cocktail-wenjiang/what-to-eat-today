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
    assert body["recommendations"][0]["recipeId"] == "R-001"
    assert body["recommendations"][0]["source"] == "db"

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
