# Authentication

Every request except `GET /v1/health` carries a bearer token.

```bash
curl "$AUCTRA_URL/v1/auctions" \
  -H "Authorization: Bearer sk_test_4f1c8b9d2e6a0b1c2d3e4f5a6b7c8d9e"
```

Keys are **server-side only**. `Access-Control-Allow-Origin` is not set on any endpoint, which means a browser cannot call Auctra directly — deliberately. A key in a bundled frontend is a key in a public repository. Proxy through your own backend.

## Key format

| Prefix | Environment | Chain |
|---|---|---|
| `sk_test_` | Sandbox | Sepolia (11155111) |
| `sk_live_` | Production | Ethereum mainnet (1) |

Sending an `sk_live_` key to the sandbox host returns:

```json
{
  "error": {
    "type": "authentication_error",
    "code": "environment_mismatch",
    "message": "A sk_live_ key was used against the sandbox host. Keys are not portable across environments.",
    "request_id": "req_9f2ac71b3d8e4a05"
  }
}
```

This gets its own error code because mixing environments is the single most common integration bug, and `invalid_api_key` would send you looking in the wrong place for an hour.

## Scopes

A key carries scopes. Read-only keys are the right default for anything that renders a catalogue page.

| Scope | Grants |
|---|---|
| `auctions:read` | List and retrieve auctions, bids, refunds, events, transactions |
| `auctions:write` | Create auctions, prepare bids, settle, cancel, claim, broadcast |
| `webhooks:read` | List webhook endpoints |
| `webhooks:write` | Create and delete webhook endpoints |

A request missing a scope returns `403 insufficient_scope`, naming the scope it wanted.

## How we store keys

We store `sha256(key + pepper)`. The raw key is displayed once, at creation, and then it is gone from our systems. This has a consequence you should plan for: **we cannot recover a lost key.** There is no support ticket that ends with someone reading your key back to you. Rotate it.

## If a key leaks

1. Create a replacement key first. Both work at once; there's no cutover gap.
2. Deploy the new key.
3. Revoke the old one. Revocation is immediate — the next request with it gets `invalid_api_key`.

Then read the event log. `GET /v1/events` is authoritative about what actually happened under that key, and unlike your application logs, it wasn't written by the attacker.

Worth knowing: a leaked Auctra key **cannot spend anyone's money**. It can prepare transactions, but a prepared transaction is just bytes until a private key signs it. The blast radius is your auction metadata and your read data — bad, but survivable. This is not an accident of the design; it is the reason for it.
