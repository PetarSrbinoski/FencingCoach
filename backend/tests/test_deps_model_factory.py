"""Unit tests for the local/cloud model factory in `agents/deps.py`.

Covers `get_model_for_provider()` — the "which pool of models" builder
that backs the manual local/cloud toggle — without making any real
network calls (just checking what gets constructed).
"""

from __future__ import annotations

import pytest
from app.agents import deps as deps_module
from app.core.config import settings
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel


@pytest.fixture(autouse=True)
def _clear_model_cache():
    """`get_model_for_provider` is `lru_cache`d — clear it so each test's
    monkeypatched settings actually take effect instead of returning a
    previous test's cached model."""
    deps_module.get_model_for_provider.cache_clear()
    yield
    deps_module.get_model_for_provider.cache_clear()


def test_local_provider_builds_plain_chat_model(monkeypatch):
    monkeypatch.setattr(settings, "LLM_MODEL", "ornith35-mtp-coder")
    monkeypatch.setattr(settings, "LLM_BASE_URL", "http://laptop:8080/v1")

    model = deps_module.get_model_for_provider("local")

    assert isinstance(model, OpenAIChatModel)
    assert model.model_name == "ornith35-mtp-coder"


def test_cloud_provider_builds_fallback_chain_of_two_when_both_configured(monkeypatch):
    monkeypatch.setattr(settings, "LLM_FALLBACK_MODEL", "deepseek-ai/deepseek-v4-flash")
    monkeypatch.setattr(settings, "LLM_FALLBACK_BASE_URL", "https://integrate.api.nvidia.com/v1")
    monkeypatch.setattr(settings, "LLM_FALLBACK_API_KEY", "test-key")
    monkeypatch.setattr(settings, "LLM_FALLBACK2_MODEL", "meta/llama-3.3-70b-instruct")

    model = deps_module.get_model_for_provider("cloud")

    assert isinstance(model, FallbackModel)
    assert [m.model_name for m in model.models] == [
        "deepseek-ai/deepseek-v4-flash",
        "meta/llama-3.3-70b-instruct",
    ]


def test_cloud_provider_single_tier_when_fallback2_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "LLM_FALLBACK_MODEL", "deepseek-ai/deepseek-v4-flash")
    monkeypatch.setattr(settings, "LLM_FALLBACK_BASE_URL", "https://integrate.api.nvidia.com/v1")
    monkeypatch.setattr(settings, "LLM_FALLBACK_API_KEY", "test-key")
    monkeypatch.setattr(settings, "LLM_FALLBACK2_MODEL", "")

    model = deps_module.get_model_for_provider("cloud")

    assert isinstance(model, OpenAIChatModel)
    assert model.model_name == "deepseek-ai/deepseek-v4-flash"


def test_cloud_provider_without_fallback_model_configured_raises(monkeypatch):
    monkeypatch.setattr(settings, "LLM_FALLBACK_MODEL", "")

    with pytest.raises(RuntimeError):
        deps_module.get_model_for_provider("cloud")


def test_unknown_provider_raises_value_error():
    with pytest.raises(ValueError):
        deps_module.get_model_for_provider("bogus")


def test_active_model_label_reflects_toggle(monkeypatch):
    monkeypatch.setattr(settings, "LLM_MODEL", "ornith35-mtp-coder")
    monkeypatch.setattr(settings, "LLM_FALLBACK_MODEL", "deepseek-ai/deepseek-v4-flash")

    deps_module.set_active_provider("local")
    assert deps_module.active_model_label() == "ornith35-mtp-coder"

    deps_module.set_active_provider("cloud")
    assert deps_module.active_model_label() == "deepseek-ai/deepseek-v4-flash"

    deps_module.set_active_provider("local")  # reset for other tests
