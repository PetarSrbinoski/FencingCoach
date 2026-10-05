"""Recorded speech becomes a durable, editable nutrition draft before any write."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import date
from io import BytesIO
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from openai import AsyncOpenAI
from pydantic import BaseModel, Field, ValidationError, model_validator
from pydantic_ai import Agent
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.deps import get_active_model, get_model
from app.agents.nutrition import _estimate_unlisted
from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.models import AgentAction, NutritionLog, VoiceDraft
from app.schemas.foods import FoodPortion, SavedFoodInput
from app.services import foods
from app.services.agent_actions import present, record_action, snapshot
from app.services.transactions import lock_meal_inputs

log = logging.getLogger(__name__)
router = APIRouter(prefix="/nutrition/voice", tags=["nutrition"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_RECORDING_SECONDS = 60
SUPPORTED_AUDIO = {"audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"}


class VoiceFood(SavedFoodInput):
    basis: str = Field(pattern="^(per_100g|per_serving)$")
    basis_grams: float | None = Field(default=None, gt=0)
    consumed_grams: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def check_basis(self) -> VoiceFood:
        if self.basis == "per_serving" and self.basis_grams is None:
            raise ValueError("Per-serving values need a gram weight before they can be used.")
        return self


class VoiceInterpretation(BaseModel):
    intent: str = Field(pattern="^(save_food|log_consumption|clarify)$")
    question: str | None = None
    food: VoiceFood | None = None
    portions: list[FoodPortion] = Field(default_factory=list)
    other_foods: str = ""


class RevisionInput(BaseModel):
    expected_revision: str


class TranscriptInput(RevisionInput):
    transcript: str = Field(min_length=1, max_length=5000)


class ReviewInput(RevisionInput):
    interpretation: VoiceInterpretation


class AcceptInput(RevisionInput):
    action: str = Field(pattern="^(save_food|log_consumption)$")
    request_id: str = Field(min_length=1, max_length=100)
    day: date | None = None
    meal: str | None = Field(default=None, max_length=40)


voice_agent = Agent(
    get_model(), output_type=VoiceInterpretation,
    instructions="""Interpret the athlete's corrected transcript as a draft, not an instruction to write.
Use catalog saved-food IDs only for exact, unambiguous matches. Prefer those values to estimates.
For every saved food to log, state explicit positive grams or number of named servings.
If identity, amount, serving basis, unit conversion, or intended action is ambiguous, set
intent=clarify and ask a short question. Do not invent serving weights or density.
For an explicitly dictated product label, use food with exactly supplied values, unknown
fields as null, and basis per_100g or per_serving. Preserve micronutrient units, including IU.
Use consumed_grams only when the athlete clearly states the amount eaten. For an unsaved
meal without dictated label values, put its full description and amounts in other_foods.
Never include a saved food in other_foods. Do not guess nutrients.""",
    model_settings={"temperature": 0.0, "max_tokens": settings.LLM_MAX_TOKENS},
)


async def transcribe_audio(data: bytes, filename: str) -> str:
    """Speech adapter: OpenAI-compatible audio transcription, separate from text models."""
    if not settings.VOICE_TRANSCRIPTION_API_KEY:
        raise RuntimeError("Speech transcription is unavailable. Configure VOICE_TRANSCRIPTION_API_KEY.")
    client = AsyncOpenAI(
        api_key=settings.VOICE_TRANSCRIPTION_API_KEY,
        base_url=settings.VOICE_TRANSCRIPTION_BASE_URL,
        timeout=60,
        max_retries=1,
    )
    try:
        result = await client.audio.transcriptions.create(
            model=settings.VOICE_TRANSCRIPTION_MODEL,
            file=(filename, BytesIO(data)),
        )
        if not result.text.strip():
            raise ValueError("No speech was recognized. Record again or type a description.")
        return result.text.strip()
    finally:
        await client.close()


async def interpret_voice(transcript: str, catalog: list[dict]) -> dict:
    result = await voice_agent.run(
        json.dumps({"transcript": transcript, "saved_foods": catalog}),
        model=get_active_model(),
    )
    return result.output.model_dump()


def _draft_out(row: VoiceDraft) -> dict:
    return {
        "id": row.id, "status": row.status, "error": row.error,
        "transcript": row.transcript, "interpretation": row.interpretation,
        "revision": row.revision, "accepted_action_id": row.accepted_action_id,
    }


def _get(db: Session, draft_id: int, *, locked: bool = False) -> VoiceDraft:
    stmt = select(VoiceDraft).where(VoiceDraft.id == draft_id)
    row = db.scalar(stmt.with_for_update() if locked else stmt)
    if row is None:
        raise HTTPException(404, "Voice draft not found")
    return row


def _check_revision(row: VoiceDraft, revision: str) -> None:
    if row.revision != revision:
        raise HTTPException(409, "Draft changed. Review the latest interpretation before continuing.")
    if row.status == "cancelled":
        raise HTTPException(409, "This draft was cancelled")
    if row.accepted_action_id is not None:
        raise HTTPException(409, "This draft was already accepted")


def _catalog(db: Session) -> list[dict]:
    return [{"id": f.id, "name": f.name, "serving_name": f.serving_name,
             "serving_size_g": f.serving_size_g, "revision": f.revision}
            for f in foods.list_foods(db)]


async def _prepare(db: Session, interpretation: VoiceInterpretation) -> dict:
    """Validate matches and calculate a review snapshot without writing domain data."""
    payload = interpretation.model_dump()
    refs = {}
    parts = []
    for portion in interpretation.portions:
        food = foods.get_food(db, portion.food_id)
        refs[str(food.id)] = food.revision
        parts.append(foods.portion_values(db, portion))
    if interpretation.intent == "save_food" and interpretation.food is None:
        raise ValueError("Supply product values or clarify what should be saved.")
    if interpretation.intent == "log_consumption":
        if interpretation.food is not None:
            item = interpretation.food
            if item.consumed_grams is None:
                raise ValueError("Clarify how many grams of the dictated food were eaten.")
            assert item.basis_grams is not None or item.basis == "per_100g"
            normalized = foods.per_100g(SavedFoodInput.model_validate(item.model_dump(exclude={
                "basis", "basis_grams", "consumed_grams",
            })), item.basis_grams or 100) if item.basis == "per_serving" else SavedFoodInput.model_validate(
                item.model_dump(exclude={"basis", "basis_grams", "consumed_grams"})
            )
            missing = [key for key in foods.CORE if getattr(normalized, key) is None]
            if missing:
                raise ValueError(f"Add {', '.join(missing)} before logging this food.")
            factor = item.consumed_grams / 100
            nutrients = {key: getattr(normalized, key) * factor for key in foods.CORE}
            nutrients["fiber_g"] = (normalized.fiber_g * factor
                                    if normalized.fiber_g is not None else None)
            micros = {key: value * factor for key, value in foods.nutrient_values(normalized.micros).items()}
            parts.append({**nutrients, "micros": micros, "items": [{
                "name": item.name, "qty_g": item.consumed_grams, "source": "supplied",
                "nutrients": {**{k: v for k, v in nutrients.items() if v is not None}, **micros},
            }], "incomplete_micros": []})
        if interpretation.other_foods.strip():
            est = await _estimate_unlisted(interpretation.other_foods, db)
            estimate = est.model_dump()
            estimate["micros"] = est.micros.model_dump(exclude_none=True)
            estimate["items"] = [item.model_dump() for item in est.items]
            parts.append(estimate)
        if not parts:
            raise ValueError("Clarify what was eaten and how much.")
        payload["preview"] = foods.combine_portions(parts)
    payload["food_revisions"] = refs
    return payload


async def _process(draft_id: int, revision: str, audio: bytes | None, filename: str | None,
                   corrected_transcript: str | None = None) -> None:
    try:
        transcript = corrected_transcript or await transcribe_audio(audio or b"", filename or "speech.webm")
        with SessionLocal() as db:
            row = _get(db, draft_id)
            if row.status != "pending" or row.revision != revision:
                return
            row.transcript = transcript
            db.commit()
            catalog = _catalog(db)
        interpretation = VoiceInterpretation.model_validate(await interpret_voice(transcript, catalog))
        with SessionLocal() as db:
            payload = await _prepare(db, interpretation)
            row = _get(db, draft_id, locked=True)
            if row.status != "pending" or row.revision != revision:
                return
            row.interpretation = payload
            row.status = "done"
            row.error = None
            db.commit()
    except (Exception, asyncio.CancelledError) as exc:
        log.exception("Voice draft %s processing failed", draft_id)
        with SessionLocal() as db:
            row = _get(db, draft_id, locked=True)
            if row.status == "pending" and row.revision == revision:
                row.status = "error"
                row.error = "Voice processing was interrupted" if isinstance(exc, asyncio.CancelledError) else str(exc)
                db.commit()
        if isinstance(exc, asyncio.CancelledError):
            raise


@router.post("", status_code=202)
async def submit_voice(request: Request, tasks: BackgroundTasks, db: Session = Depends(get_db)) -> dict:
    media_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
    if media_type not in SUPPORTED_AUDIO:
        raise HTTPException(415, "Supported audio: webm, mp4, mp3, wav, or ogg")
    if int(request.headers.get("content-length", "0") or 0) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Recording exceeds 10 MB")
    audio = await request.body()
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(413 if audio else 422, "Recording is empty or exceeds 10 MB")
    suffix = {"audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3",
              "audio/wav": "wav", "audio/ogg": "ogg"}[media_type]
    row = VoiceDraft(status="pending", revision=uuid4().hex)
    db.add(row)
    db.commit()
    db.refresh(row)
    tasks.add_task(_process, row.id, row.revision, audio, f"speech.{suffix}")
    return _draft_out(row)


@router.get("/options")
def voice_options() -> dict:
    return {
        "supported_audio": sorted(SUPPORTED_AUDIO),
        "max_audio_bytes": MAX_AUDIO_BYTES,
        "max_recording_seconds": MAX_RECORDING_SECONDS,
        "audio_retention": "discarded after transcription; transcripts and drafts are retained",
        "transcription_available": bool(settings.VOICE_TRANSCRIPTION_API_KEY),
    }


@router.get("/{draft_id}")
def get_voice(draft_id: int, db: Session = Depends(get_db)) -> dict:
    return _draft_out(_get(db, draft_id))


@router.put("/{draft_id}/transcript", status_code=202)
def correct_transcript(draft_id: int, body: TranscriptInput, tasks: BackgroundTasks,
                       db: Session = Depends(get_db)) -> dict:
    row = _get(db, draft_id, locked=True)
    _check_revision(row, body.expected_revision)
    row.revision = uuid4().hex
    row.transcript = body.transcript.strip()
    row.interpretation = None
    row.status = "pending"
    row.error = None
    db.commit()
    tasks.add_task(_process, row.id, row.revision, None, None, row.transcript)
    return _draft_out(row)


@router.put("/{draft_id}/review")
async def revise_review(draft_id: int, body: ReviewInput, db: Session = Depends(get_db)) -> dict:
    row = _get(db, draft_id, locked=True)
    _check_revision(row, body.expected_revision)
    if row.status != "done":
        raise HTTPException(409, "Wait for interpretation to finish")
    try:
        payload = await _prepare(db, body.interpretation)
    except (foods.FoodError, ValueError, ValidationError) as exc:
        raise HTTPException(422, str(exc)) from exc
    row.interpretation = payload
    row.revision = uuid4().hex
    db.commit()
    return _draft_out(row)


@router.post("/{draft_id}/cancel")
def cancel_voice(draft_id: int, db: Session = Depends(get_db)) -> dict:
    row = _get(db, draft_id, locked=True)
    if row.accepted_action_id is not None:
        raise HTTPException(409, "Already accepted; use Agent logs to undo")
    row.status = "cancelled"
    row.interpretation = None
    row.revision = uuid4().hex
    db.commit()
    return _draft_out(row)


@router.post("/{draft_id}/accept")
def accept_voice(draft_id: int, body: AcceptInput, db: Session = Depends(get_db)) -> dict:
    row = _get(db, draft_id, locked=True)
    if row.accepted_action_id is not None:
        action = db.get(AgentAction, row.accepted_action_id)
        assert action is not None
        return present(db, action)
    _check_revision(row, body.expected_revision)
    if row.status != "done" or not row.interpretation:
        raise HTTPException(409, "Review a completed draft before accepting")
    interpretation = VoiceInterpretation.model_validate(row.interpretation)
    if interpretation.intent != body.action:
        raise HTTPException(422, "Clarify the intended action before accepting")
    for key, revision in row.interpretation.get("food_revisions", {}).items():
        food = foods.get_food(db, int(key))
        if food.revision != revision:
            raise HTTPException(409, f"{food.name} changed. Reinterpret and review this draft.")
    try:
        if body.action == "save_food":
            assert interpretation.food is not None
            item = interpretation.food
            data = SavedFoodInput.model_validate(item.model_dump(exclude={
                "basis", "basis_grams", "consumed_grams",
            }))
            if item.basis == "per_serving":
                assert item.basis_grams is not None
                data = foods.per_100g(data, item.basis_grams)
            food = foods.save_food(db, data, commit=False)
            action = record_action(db, "food_create", food.id, f"Saved {food.name} from voice draft",
                                   None, snapshot(food, "food_create"))
        else:
            if body.day is None or not body.meal:
                raise HTTPException(422, "Review the day and meal before logging")
            values = row.interpretation.get("preview")
            if not values:
                raise HTTPException(409, "The meal needs a new review")
            # Resolve saved foods again while the draft revision is locked.
            if interpretation.portions and not interpretation.food and not interpretation.other_foods.strip():
                meal = foods.log_foods(db, interpretation.portions, day=body.day,
                                       meal=body.meal, commit=False)
            else:
                lock_meal_inputs(db)
                meta = dict(values["micros"])
                meta["items"] = values["items"]
                meta["incomplete_micros"] = values["incomplete_micros"]
                meal = NutritionLog(day=body.day, meal=body.meal, raw_text=row.transcript or "Voice meal",
                                    kcal=values["kcal"], protein_g=values["protein_g"],
                                    carbs_g=values["carbs_g"], fat_g=values["fat_g"],
                                    fiber_g=values["fiber_g"], micros=meta, estimated_by="voice")
                db.add(meal)
                db.flush()
            action = record_action(db, "meal", meal.id, f"Logged {body.meal} from voice draft",
                                   None, snapshot(meal, "meal"))
        action.request_key = f"voice:{row.id}:{body.request_id}"
        row.accepted_action_id = action.id
        db.commit()
        return present(db, action)
    except foods.FoodError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc
