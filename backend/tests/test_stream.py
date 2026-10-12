import asyncio
import json

from fastapi.testclient import TestClient

from app.events import QUEUE_MAXSIZE, EventBus
from app.main import _admin_event_stream, app, bus


client = TestClient(app)


def _parse_sse(text: str) -> list[dict]:
    """从 SSE 响应文本中解析所有 data 帧（忽略 ':' 注释心跳帧）。"""
    events = []
    for frame in text.split("\n\n"):
        for line in frame.split("\n"):
            if line.startswith("data:"):
                events.append(json.loads(line[5:].strip()))
    return events


def _frame_payload(frame: str) -> dict:
    """解析单帧 SSE 文本为事件字典。"""
    return json.loads(frame.split("data:", 1)[1].strip())


# ---------------------------------------------------------------- 事件总线单元测试

def test_bus_broadcasts_event_to_all_subscribers():
    async def scenario():
        bus = EventBus()
        first = bus.subscribe()
        second = bus.subscribe()
        assert bus.subscriber_count == 2

        bus.publish({"type": "ping", "n": 1})

        assert json.loads(await first.get()) == {"type": "ping", "n": 1}
        assert json.loads(await second.get()) == {"type": "ping", "n": 1}

        bus.unsubscribe(first)
        assert bus.subscriber_count == 1

    asyncio.run(scenario())


def test_bus_drops_oldest_event_for_slow_consumer():
    async def scenario():
        bus = EventBus()
        queue = bus.subscribe()

        for seq in range(QUEUE_MAXSIZE + 5):
            bus.publish({"seq": seq})

        assert queue.qsize() == QUEUE_MAXSIZE
        # 缓冲溢出时应丢弃最旧的 5 条，保留最新的事件。
        assert json.loads(await queue.get())["seq"] == 5

    asyncio.run(scenario())


def test_bus_publish_without_subscribers_is_noop():
    bus = EventBus()
    bus.publish({"type": "ignored"})  # 不应抛异常
    assert bus.subscriber_count == 0


# ---------------------------------------------------------------- 路由注册

def test_realtime_routes_are_registered():
    paths = {route.path for route in app.routes}
    assert "/api/recommend/stream" in paths
    assert "/api/admin/stream" in paths


# ---------------------------------------------------------------- 用户端流式推荐

def test_recommend_stream_emits_start_recipes_and_done():
    response = client.post(
        "/api/recommend/stream",
        json={"servings": 2, "max_minutes": 30, "preference": "清淡", "allergy": "花生"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse(response.text)
    assert events[0]["type"] == "start"
    assert events[0]["candidates"] >= 1
    assert events[-1]["type"] == "done"

    recipes = [event for event in events if event["type"] == "recipe"]
    assert len(recipes) == events[-1]["count"]
    # 逐帧序号应连续，便于前端渲染进度
    assert [event["index"] for event in recipes] == list(range(1, len(recipes) + 1))

    # 不硬编码菜谱 ID，只校验结果满足筛选条件
    for event in recipes:
        assert event["recipe"]["source"] == "db"
        assert event["recipe"]["minutes"] <= 30

    # done 事件需自包含筛选条件，供管理后台广播复用
    assert events[-1]["criteria"]["preference"] == "清淡"

    # 流式推荐同样需要落库，供历史接口查询
    history = client.get("/api/recommendations/history")
    assert history.status_code == 200
    assert history.json()[0]["preference"] == "清淡"


def test_recommend_stream_rejects_invalid_input():
    response = client.post(
        "/api/recommend/stream",
        json={"servings": 0, "max_minutes": 30, "preference": "清淡"},
    )
    assert response.status_code == 422
    assert "servings" in response.text


# ---------------------------------------------------------------- 管理后台实时监控

def test_admin_event_stream_pushes_published_events():
    """直接驱动事件流生成器，验证订阅、首帧、广播下发与订阅清理。"""
    async def scenario():
        queue = bus.subscribe()
        stream = _admin_event_stream(queue)

        connected = _frame_payload(await anext(stream))
        assert connected["type"] == "connected"
        assert connected["subscribers"] >= 1

        bus.publish({"type": "recommendation", "id": 7, "count": 2, "recipes": ["番茄炒蛋"]})

        payload = _frame_payload(await anext(stream))
        assert payload["type"] == "recommendation"
        assert payload["id"] == 7

        await stream.aclose()
        assert bus.subscriber_count == 0

    asyncio.run(scenario())


def test_recommendation_broadcast_carries_criteria_and_recipes():
    """端到端：一次流式推荐应把 started 与 recommendation 两类事件推给订阅者。"""
    async def scenario():
        queue = bus.subscribe()
        client.post(
            "/api/recommend/stream",
            json={"servings": 1, "max_minutes": 20, "preference": "素食"},
        )

        received = []
        while not queue.empty():
            received.append(json.loads(queue.get_nowait()))

        bus.unsubscribe(queue)

        types = [event["type"] for event in received]
        assert "recommendation_started" in types
        assert "recommendation" in types

        final = next(event for event in received if event["type"] == "recommendation")
        assert final["criteria"]["preference"] == "素食"
        assert final["count"] >= 1

    asyncio.run(scenario())
