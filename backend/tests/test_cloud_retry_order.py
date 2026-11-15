"""Exercise SDK retry exhaustion through the real cloud fallback model."""
import asyncio
import json

import httpx
from contextlib import contextmanager


@contextmanager
def expect_exhaustion():
    try:
        yield
    except ExceptionGroup:
        return
    raise AssertionError('Expected fallback exhaustion')

from openai import AsyncOpenAI
from pydantic_ai.messages import ModelRequest, UserPromptPart
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.agents.retry import acall_with_transient_retry, is_transient_llm_error


def check_cloud_exhaustion(stream, failure):
    calls = []

    def handle(request):
        calls.append(json.loads(request.content)["model"])
        if failure == "connection":
            raise httpx.ConnectError("offline", request=request)
        return httpx.Response(503, json={"error": {"message": "unavailable"}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
            models = [
                OpenAIChatModel(
                    name,
                    provider=OpenAIProvider(openai_client=AsyncOpenAI(
                        api_key="test", base_url="https://example.test/v1",
                        http_client=http, max_retries=2,
                    )),
                )
                for name in ("primary", "backup")
            ]
            model = FallbackModel(*models, fallback_on=is_transient_llm_error)

            async def request():
                args = ([ModelRequest(parts=[UserPromptPart("hello")])],
                        None, ModelRequestParameters())
                if stream:
                    async with model.request_stream(*args):
                        pass
                else:
                    await model.request(*args)

            with expect_exhaustion():
                await acall_with_transient_retry(request, label="test")

    asyncio.run(run())
    assert calls == ["primary"] * 3 + ["backup"] * 3


def test_cloud_exhaustion_does_not_restart_primary():
    for stream in (False, True):
        for failure in ("503", "connection"):
            check_cloud_exhaustion(stream, failure)


if __name__ == "__main__":
    test_cloud_exhaustion_does_not_restart_primary()
    print("All four cloud retry scenarios passed")
