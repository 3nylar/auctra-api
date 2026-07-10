---
title: Changelog
description: Versions are dated. Breaking changes get a new one.
section: Reference
slug: changelog
---

The API version is pinned by date and returned on every response:

```http
Auctra-Version: 2026-07-01
```

Additive changes — a new field, a new endpoint, a new event type — ship to every version without warning. **Write clients that ignore fields they don't recognise.** Breaking changes get a new dated version, and the old one keeps working.

---

## `2026-07-01` — Initial release

The first public version.

- **Auctions.** Create, list, retrieve, settle, cancel, claim.
- **Bids.** Prepare and list. Validated against the live minimum and simulated against the bidder's address before they cost gas.
- **Refunds.** Query credited balances, read live on-chain balances, prepare a withdrawal.
- **Transactions.** Broadcast a signed transaction; poll for confirmation.
- **Webhooks.** Eleven event types, HMAC-signed, retried seven times over 32 hours, backed by a replayable event log at `GET /v1/events`.
- **Idempotency** on every `POST`, with a 24-hour window.
- **Cursor pagination** on every list.

### Design decisions worth stating once

**Amounts are decimal strings of wei.** They will never become JSON numbers. Doubles lose integer precision above 2<sup>53</sup>, and wei amounts routinely exceed it.

**No custodial bidding.** `POST /v1/auctions/{id}/bids` returns a transaction to sign and always will. Bidding spends the bidder's balance; only their key can authorise it. `mode: "managed"` exists for organisation-owned operations and is rejected on this endpoint.

**Two confirmations before an event fires.** A reorg that un-mines a bid after we've told you someone won is a worse bug than four seconds of latency.

**Statuses are derived, not stored.** An auction whose `end_time` has passed reads as `ended`, whatever the database says. Cache the fields; don't cache the status.
