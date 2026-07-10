---
title: Rate limits
description: 100 requests a minute, per key, and how to not need them.
section: Core concepts
slug: rate-limits
---

**100 requests per minute, per API key.** Every response tells you where you stand.

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 61
X-RateLimit-Reset: 1752076860
```

Exceed it and you get `429` with a `Retry-After` in seconds:

```json
{
  "error": {
    "type": "rate_limit_error",
    "code": "rate_limit_exceeded",
    "message": "Too many requests. Back off and retry after the interval in Retry-After.",
    "request_id": "req_2c8f1a94e0d7b365"
  }
}
```

Limits are keyed to the **API key**, not the IP address. Two customers behind one corporate NAT don't exhaust each other's budget, and running your service across ten pods doesn't multiply your allowance — the budget belongs to the key, so split traffic across several keys if you need to isolate a noisy job from a user-facing path.

## Respect `Retry-After`

```js
if (res.status === 429) {
  const wait = Number(res.headers.get("retry-after") ?? 1);
  await sleep(wait * 1000 + Math.random() * 500);  // jitter, or your pods sync up
  return retry();
}
```

Jitter matters more than it looks. Ten workers that all sleep exactly one second will all wake up in the same millisecond and hit the same wall together.

## The polling trap

The usual way to run out of budget is a countdown page.

Fifty people watching one auction, each polling `GET /v1/auctions/{id}` every two seconds, is 1,500 requests a minute against a limit of 100 — and 1,499 of them return exactly what the last one did.

Don't poll for state that we already push:

- **Subscribe to `auction.bid_placed` and `auction.extended`.** One webhook per real change.
- **Fan out from your own server.** Take the webhook, push it to connected browsers over SSE or WebSocket. Your users get updates in a hundred milliseconds instead of two seconds, and you spend one request instead of fifteen hundred.
- **Poll only what has no event**, like a transaction hash you're waiting on, and stop as soon as it confirms.

If you genuinely need a higher limit — a marketplace with tens of thousands of concurrent lots — mail `developers@auctra.dev` with your expected request pattern. We'd rather raise your limit than have you build a proxy that hides the problem from both of us.

## Not rate limited

`GET /v1/health` is unauthenticated and unlimited. Point your uptime checks at it.
