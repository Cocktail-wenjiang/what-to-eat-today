import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 加载环境变量（在导入其他模块之前）
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from .data import list_history
from .models import RecommendationRequest
from .services import recommend


app = FastAPI(title="今天吃什么 AI 饮食推荐", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
logger = logging.getLogger("what_to_eat")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "database": "sqlite-local",
        "version": "0.2.0"
    }


@app.post("/api/recommend")
def create_recommendation(request: RecommendationRequest):
    logger.info("recommendation request preference=%s max_minutes=%s", request.preference, request.max_minutes)
    record_id, recommendations = recommend(request.model_dump())
    logger.info("recommendation saved id=%s count=%s", record_id, len(recommendations))
    return {
        "id": record_id,
        "recommendations": recommendations,
        "mode": "rule-fallback",
        "database": "sqlite-local"
    }


@app.get("/api/recommendations/history")
def recommendation_history():
    return list_history()
