"""进程内发布/订阅事件总线。

用于把用户端的推荐事件实时广播给管理后台的 SSE 订阅者。
当前为单进程内存实现；后续接入多实例部署时，可替换为 Redis Pub/Sub
或消息队列，对外暴露的 subscribe / publish 契约保持不变。
"""

import asyncio
import json
from typing import Any

# 单个订阅者的缓冲上限；超出后丢弃最旧事件，避免慢消费者阻塞发布方。
QUEUE_MAXSIZE = 100


class EventBus:
    """极简广播总线：一次 publish，所有订阅者各收到一份。"""

    def __init__(self) -> None:
        # 仅在事件循环内进行 add/discard/快照，均为同步原子操作，无需额外加锁。
        self._subscribers: set[asyncio.Queue[str]] = set()

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def subscribe(self) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[str]) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: dict[str, Any]) -> None:
        """广播事件；无订阅者时直接返回，不做序列化开销。"""
        if not self._subscribers:
            return
        payload = json.dumps(event, ensure_ascii=False)
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                # 慢消费者：丢弃最旧一条后重试，保证发布方永不阻塞。
                try:
                    queue.get_nowait()
                    queue.put_nowait(payload)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass


bus = EventBus()
