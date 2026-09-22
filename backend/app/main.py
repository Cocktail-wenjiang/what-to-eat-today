import logging

from fastapi import FastAPI

from .data import list_history
from .models import RecommendationRequest
from .services import recommend


app = FastAPI(title="今天吃什么 AI 饮食推荐", version="0.1.0")
logger = logging.getLogger("what_to_eat")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/recommend")
def create_recommendation(request: RecommendationRequest):
    logger.info("recommendation request preference=%s max_minutes=%s", request.preference, request.max_minutes)
    record_id, recommendations = recommend(request.model_dump())
    logger.info("recommendation saved id=%s count=%s", record_id, len(recommendations))
    return {"id": record_id, "recommendations": recommendations, "mode": "rule-fallback"}


@app.get("/api/recommendations/history")
def recommendation_history():
    return list_history()
