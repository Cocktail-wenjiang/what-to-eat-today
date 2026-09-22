from fastapi import FastAPI

from .data import list_history
from .models import RecommendationRequest
from .services import recommend


app = FastAPI(title="今天吃什么 AI 饮食推荐", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/recommend")
def create_recommendation(request: RecommendationRequest):
    record_id, recommendations = recommend(request.model_dump())
    return {"id": record_id, "recommendations": recommendations, "mode": "rule-fallback"}


@app.get("/api/recommendations/history")
def recommendation_history():
    return list_history()
