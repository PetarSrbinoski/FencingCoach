"""USDA food database endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser
from app.schemas import USDAFoodOut, USDAImportResult, USDASearchResult
from app.services import usda as usda_service

router = APIRouter(prefix="/usda", tags=["usda"])


@router.post("/import", response_model=USDAImportResult)
def import_foods(
    _user: CurrentUser,
    max_pages: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
) -> USDAImportResult:
    """Import common foods from USDA FoodData Central."""
    result = usda_service.import_common_foods(db, max_pages=max_pages)
    return USDAImportResult(**result)


@router.get("/search", response_model=USDASearchResult)
def search_foods(
    q: str,
    _user: CurrentUser,
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
) -> USDASearchResult:
    """Search local USDA food cache."""
    results = usda_service.search_foods(db, q, limit=limit)
    return USDASearchResult(
        query=q,
        results=[USDAFoodOut.model_validate(r, from_attributes=True) for r in results],
        count=len(results),
    )


@router.get("/match")
def match_meal(
    text: str,
    _user: CurrentUser,
    db: Session = Depends(get_db),
) -> list[dict]:
    """Cross-reference a meal description against USDA data."""
    return usda_service.cross_reference_meal(db, text)
