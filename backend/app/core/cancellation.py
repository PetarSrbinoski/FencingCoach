"""Cancel an in-flight async request if the client disconnects.

FastAPI/Starlette don't automatically cancel a running `async def` route
handler when the client goes away — that's only handled for free by
`StreamingResponse` (see `api/chat.py`'s SSE endpoint, which gets
cancellation propagation "for free" once the ASGI server notices the
closed connection between yields). For a regular one-shot JSON endpoint
backed by a slow LLM call (e.g. `POST /nutrition/estimate`), nothing
polls for a disconnect on its own, so a client-side "Cancel" (aborting
the fetch) has no effect on the backend by default — the LLM call just
keeps running to completion, wasting the request and (if a DB write
followed) risking stale/unwanted side effects.

`run_cancellable` fixes this generically: it races the real work against
a polling task that watches `request.is_disconnected()`, and cancels the
work the moment the client goes away.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable

from fastapi import HTTPException, Request

# How often to poll for a client disconnect while work is in flight.
# Cancellation latency is bounded by this interval.
POLL_INTERVAL_SECONDS = 0.5


async def _watch_disconnect(request: Request) -> None:
    while not await request.is_disconnected():
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def run_cancellable[T](request: Request, coro: Awaitable[T]) -> T:
    """Await `coro`, cancelling it early if `request` disconnects first.

    Raises `HTTPException(499)` if the client disconnected before the
    work finished (499 "Client Closed Request" is the nginx convention
    for this — there's no official HTTP status for it). In practice the
    client will never see this response (it already disconnected), but
    it keeps server logs/metrics honest about why the request ended.
    """
    work_task: asyncio.Task[T] = asyncio.ensure_future(coro)
    watch_task = asyncio.ensure_future(_watch_disconnect(request))
    try:
        done, _pending = await asyncio.wait(
            {work_task, watch_task}, return_when=asyncio.FIRST_COMPLETED
        )
        if work_task in done:
            return work_task.result()

        # Client disconnected first — cancel the still-running work and
        # wait for it to actually unwind before returning, so any
        # cleanup (e.g. closing the underlying LLM HTTP connection)
        # happens deterministically rather than being abandoned.
        work_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await work_task
        raise HTTPException(499, "Client closed request")
    finally:
        if not watch_task.done():
            watch_task.cancel()
