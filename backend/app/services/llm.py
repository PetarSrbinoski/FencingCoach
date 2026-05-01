"""LLM client wrapper.

Speaks to ANY OpenAI-compatible endpoint (Ollama, OpenAI, NVIDIA NIM,
OpenRouter, Together.ai, llama.cpp, vLLM, ...) via the official OpenAI
Python SDK. Swap providers by changing env vars only — no code change.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Iterable, Iterator

from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

from app.core.config import settings

log = logging.getLogger(__name__)

# Regex to strip <think>...</think> blocks that reasoning models may emit
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def _strip_think_tags(text: str) -> str:
    """Remove reasoning chain-of-thought tags if present."""
    return _THINK_RE.sub("", text).strip()


@dataclass
class LLMResponse:
    content: str
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LLMClient:
    """Thin wrapper around `openai.OpenAI` configured from settings."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        self.base_url = base_url or settings.LLM_BASE_URL
        # OpenAI SDK requires a non-empty api_key string even for local servers.
        self.api_key = api_key or settings.LLM_API_KEY or "not-needed"
        self.model = model or settings.LLM_MODEL
        self._client = OpenAI(base_url=self.base_url, api_key=self.api_key)

    # ── completions ────────────────────────────────────────────────
    def chat(
        self,
        messages: Iterable[ChatCompletionMessageParam],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> LLMResponse:
        resp = self._client.chat.completions.create(
            model=self.model,
            messages=list(messages),
            max_tokens=max_tokens or settings.LLM_MAX_TOKENS,
            temperature=settings.LLM_TEMPERATURE
            if temperature is None
            else temperature,
        )
        choice = resp.choices[0]
        usage = resp.usage
        # Some reasoning models (Nemotron Super/Ultra) put output in
        # `reasoning_content` and leave `content` null.
        raw = (
            choice.message.content
            or getattr(choice.message, "reasoning_content", None)
            or ""
        )
        return LLMResponse(
            content=_strip_think_tags(raw),
            model=resp.model,
            prompt_tokens=usage.prompt_tokens if usage else None,
            completion_tokens=usage.completion_tokens if usage else None,
        )

    def stream_chat(
        self,
        messages: Iterable[ChatCompletionMessageParam],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> Iterator[str]:
        stream = self._client.chat.completions.create(
            model=self.model,
            messages=list(messages),
            max_tokens=max_tokens or settings.LLM_MAX_TOKENS,
            temperature=settings.LLM_TEMPERATURE
            if temperature is None
            else temperature,
            stream=True,
        )
        in_think = False
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                text = delta.content
                # Filter out <think>...</think> blocks from stream
                if "<think>" in text:
                    in_think = True
                    text = text.split("<think>")[0]
                if in_think:
                    if "</think>" in text:
                        in_think = False
                        text = text.split("</think>", 1)[-1]
                    else:
                        continue
                if text:
                    yield text

    def health(self) -> bool:
        """Quick liveness probe against the LLM endpoint."""
        try:
            self._client.models.list()
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("LLM health check failed: %s", e)
            return False


# Singleton convenience
_llm: LLMClient | None = None


def get_llm() -> LLMClient:
    global _llm
    if _llm is None:
        _llm = LLMClient()
    return _llm
