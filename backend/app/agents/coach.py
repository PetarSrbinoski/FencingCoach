"""Coach chat agent.

Replaces `api/chat.py` direct LLM call with a PydanticAI agent:
- Async (await agent.run()) for the chat endpoint
- Streaming (agent.run_stream()) for the SSE chat endpoint
- Full conversation history via message_history
- Context injection via dynamic instructions
- WebSearch capability for real-time lookups
- Strips <think> tags (and withholds them live during streaming)
- Heuristic grounding check flags replies that cite specific Garmin/health
  numbers not present in the injected context snapshot
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from pydantic_ai import Agent, RunContext
from pydantic_ai.capabilities import WebSearch
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)

from app.agents.deps import CoachDeps, ThinkTagStreamFilter, get_model, strip_think_tags
from app.core.config import settings
from app.services.grounding import find_ungrounded_claims
from app.services.prompts import COACH_SYSTEM_PROMPT

log = logging.getLogger(__name__)


# ── Agent definition ──────────────────────────────────────────────────
coach_agent = Agent(
    get_model(),
    output_type=str,
    instructions=COACH_SYSTEM_PROMPT,
    deps_type=CoachDeps,
    capabilities=[WebSearch()],
    model_settings={
        "temperature": 0.4,
        "max_tokens": 1200,
    },
)


@coach_agent.instructions
async def _inject_context(ctx: RunContext[CoachDeps]) -> str:
    """Inject live context snapshot into the agent's system prompt."""
    if ctx.deps.context_text:
        return ctx.deps.context_text
    return ""


@coach_agent.output_validator
async def _strip_think(ctx: RunContext[CoachDeps], result: str) -> str:
    return strip_think_tags(result)


# ── History conversion ────────────────────────────────────────────────
def _db_messages_to_history(
    messages: list[Any],
) -> list[ModelMessage]:
    """Convert DB CoachMessage rows to PydanticAI ModelMessage list.

    The DB stores role='user' and role='assistant' messages.
    PydanticAI expects ModelRequest (user) and ModelResponse (assistant).
    """
    history: list[ModelMessage] = []
    for msg in messages:
        if msg.role == "user":
            history.append(ModelRequest(parts=[UserPromptPart(content=msg.content)]))
        elif msg.role == "assistant":
            history.append(ModelResponse(parts=[TextPart(content=msg.content)]))
    return history


# ── Public API (async) ────────────────────────────────────────────────
@dataclass
class ChatResult:
    """Result from coach chat, matching what the API endpoint needs."""

    reply: str
    model: str
    ungrounded_claims: list[str] = field(default_factory=list)


async def run_coach_chat(
    user_message: str,
    *,
    context_text: str = "",
    history_messages: list[Any] | None = None,
) -> ChatResult:
    """Run the coach chat agent asynchronously.

    Args:
        user_message: The user's message text.
        context_text: Pre-built context snapshot to inject.
        history_messages: List of DB CoachMessage objects for conversation history.

    Returns:
        ChatResult with reply text, model name, and any heuristically
        flagged ungrounded claims (see `services.grounding`).
    """
    deps = CoachDeps(db=None, context_text=context_text)  # type: ignore[arg-type]

    # Convert DB message history to PydanticAI format
    message_history: list[ModelMessage] | None = None
    if history_messages:
        message_history = _db_messages_to_history(history_messages)

    result = await coach_agent.run(
        user_message,
        deps=deps,
        message_history=message_history,
    )

    reply = result.output
    ungrounded = find_ungrounded_claims(reply, context_text)
    if ungrounded:
        log.warning("coach reply has possibly ungrounded claims: %s", ungrounded)

    return ChatResult(
        reply=reply,
        model=settings.LLM_MODEL,
        ungrounded_claims=ungrounded,
    )


async def stream_coach_chat(
    user_message: str,
    *,
    context_text: str = "",
    history_messages: list[Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream the coach chat agent's reply as it's generated.

    Yields `{"delta": str}` chunks (already filtered of any `<think>...
    </think>` reasoning text) as they arrive, then a single terminal
    `{"done": True, "reply": ..., "model": ..., "ungrounded_claims": [...]}`
    once the stream completes.
    """
    deps = CoachDeps(db=None, context_text=context_text)  # type: ignore[arg-type]

    message_history: list[ModelMessage] | None = None
    if history_messages:
        message_history = _db_messages_to_history(history_messages)

    filt = ThinkTagStreamFilter()
    chunks: list[str] = []

    async with coach_agent.run_stream(
        user_message,
        deps=deps,
        message_history=message_history,
    ) as stream:
        async for delta in stream.stream_text(delta=True):
            visible = filt.feed(delta)
            if visible:
                chunks.append(visible)
                yield {"delta": visible}

    tail = filt.flush()
    if tail:
        chunks.append(tail)
        yield {"delta": tail}

    reply = "".join(chunks).strip()
    ungrounded = find_ungrounded_claims(reply, context_text)
    if ungrounded:
        log.warning("coach reply has possibly ungrounded claims: %s", ungrounded)

    yield {
        "done": True,
        "reply": reply,
        "model": settings.LLM_MODEL,
        "ungrounded_claims": ungrounded,
    }
