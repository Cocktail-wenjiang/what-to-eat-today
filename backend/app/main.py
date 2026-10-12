import asyncio
import json
import logging
import os
from typing import Any, AsyncIterator, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# 加载环境变量（在导入其他模块之前）
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from .data import list_history
from .events import bus
from .models import RecommendationRequest
from .services import iter_recommendation_events, recommend


app = FastAPI(title="今天吃什么 AI 饮食推荐", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    # 管理后台监控页可能由任意本地端口提供，统一放行本机来源；
    # 前端开发态经 vite 代理访问，属同源，不受此限制。
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)
logger = logging.getLogger("what_to_eat")

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    # 关闭反向代理缓冲，保证逐帧下发。
    "X-Accel-Buffering": "no",
}

# 管理后台长连接的空闲心跳间隔（秒），用于穿透代理保活。
HEARTBEAT_SECONDS = 15


def _sse(event: Optional[dict[str, Any]] = None, comment: Optional[str] = None) -> str:
    """按 SSE 规范格式化一帧：注释帧以 ':' 开头，数据帧以 'data:' 开头。"""
    if comment is not None:
        return f": {comment}\n\n"
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@app.get("/health")
def health():
    return {
        "status": "ok",
        "database": "sqlite-local",
        "version": "0.3.0",
        "admin_subscribers": bus.subscriber_count,
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


@app.post("/api/recommend/stream")
async def create_recommendation_stream(request: RecommendationRequest):
    """用户端实时推送：逐帧下发匹配进度与菜谱，并把结果广播给管理后台。"""
    payload = request.model_dump()
    logger.info("stream recommendation request preference=%s", payload["preference"])

    async def event_stream() -> AsyncIterator[str]:
        for event in iter_recommendation_events(payload):
            if event["type"] == "start":
                bus.publish({"type": "recommendation_started", "criteria": event["criteria"]})
            elif event["type"] == "done":
                bus.publish(
                    {
                        "type": "recommendation",
                        "id": event["id"],
                        "criteria": event["criteria"],
                        "count": event["count"],
                        "recipes": event["recipes"],
                        "elapsed_ms": event["elapsed_ms"],
                    }
                )
            yield _sse(event)
            # 让出控制权，确保每一帧及时 flush 到客户端。
            await asyncio.sleep(0)

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@app.get("/api/admin/stream")
async def admin_stream():
    """管理后台实时监控：订阅事件总线，持续下发推荐相关事件。"""
    return StreamingResponse(
        _admin_event_stream(bus.subscribe()),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


async def _admin_event_stream(queue: asyncio.Queue) -> AsyncIterator[str]:
    """事件流主体：首帧确认连接，随后转发总线事件，空闲时以注释帧心跳保活。"""
    try:
        yield _sse({"type": "connected", "message": "实时监控已连接", "subscribers": bus.subscriber_count})
        while True:
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                yield _sse(comment="ping")
                continue
            yield f"data: {payload}\n\n"
    finally:
        bus.unsubscribe(queue)


@app.get("/api/recommendations/history")
def recommendation_history():
    return list_history()
