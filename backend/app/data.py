"""
数据访问层 - 统一入口

菜谱种子数据来自本地 JSON（data/recipes.json），推荐历史写入本地 SQLite。
云端数据链路已整体迁移到 uniCloud（见 uni-app/），本后端只保留本地链路。
"""
import json
import sqlite3
import logging
from pathlib import Path

logger = logging.getLogger("what_to_eat.data")

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "recommendations.db"
SEED_PATH = DATA_DIR / "recipes.json"


def get_connection() -> sqlite3.Connection:
    """获取 SQLite 连接（首次调用自动创建 data 目录与数据表，实现零配置启动）"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute(
        """CREATE TABLE IF NOT EXISTS recommendation_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            servings INTEGER NOT NULL,
            max_minutes INTEGER NOT NULL,
            preference TEXT NOT NULL,
            allergy TEXT,
            recommendations TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    connection.commit()
    return connection


def load_recipes() -> list[dict]:
    """加载所有菜谱（本地 JSON 种子数据）"""
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def save_history(request: dict, recommendations: list[dict]) -> int:
    """保存一条推荐历史到本地 SQLite，返回自增 id"""
    with get_connection() as connection:
        cursor = connection.execute(
            """INSERT INTO recommendation_history
            (servings, max_minutes, preference, allergy, recommendations)
            VALUES (?, ?, ?, ?, ?)""",
            (
                request["servings"],
                request["max_minutes"],
                request["preference"],
                request.get("allergy"),
                json.dumps(recommendations, ensure_ascii=False),
            ),
        )
        connection.commit()
        return int(cursor.lastrowid)


def list_history() -> list[dict]:
    """获取最近 20 条推荐历史"""
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM recommendation_history ORDER BY id DESC LIMIT 20"
        ).fetchall()
    return [
        {
            "id": row["id"],
            "servings": row["servings"],
            "max_minutes": row["max_minutes"],
            "preference": row["preference"],
            "allergy": row["allergy"],
            "recommendations": json.loads(row["recommendations"]),
            "created_at": row["created_at"],
        }
        for row in rows
    ]
