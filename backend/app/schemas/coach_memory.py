"""Shared memory write contracts for the athlete and coach tools."""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class MemoryContent(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    content: str = Field(min_length=1, max_length=1000)
    # Inclusive last active day in ATHLETE_TIMEZONE.
    expires_on: date | None = None


class MemoryCreate(MemoryContent):
    request_id: str = Field(min_length=1, max_length=100)


class MemoryGuard(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    request_id: str = Field(min_length=1, max_length=100)
    expected_revision: str = Field(min_length=1, max_length=32)


class MemoryEdit(MemoryContent, MemoryGuard):
    pass
