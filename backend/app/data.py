import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "recommendations.db"
SEED_PATH = DATA_DIR / "recipes.json"


def get_connection() -> sqlite3.Connection:
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
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def save_history(request: dict, recommendations: list[dict]) -> int:
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
