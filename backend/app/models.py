from typing import Optional

from pydantic import BaseModel, Field


class RecommendationRequest(BaseModel):
    servings: int = Field(ge=1, le=20)
    max_minutes: int = Field(ge=5, le=240)
    preference: str = Field(min_length=1, max_length=30)
    allergy: Optional[str] = Field(default=None, max_length=30)


class Recipe(BaseModel):
    recipeId: str
    name: str
    ingredients: list[str]
    steps: list[str]
    minutes: int
    tags: list[str]
    source: str = "db"


class RecommendationRecord(RecommendationRequest):
    id: int
    created_at: str
    recommendations: list[Recipe]
