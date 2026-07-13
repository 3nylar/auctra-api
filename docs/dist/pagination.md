# Pagination

List endpoints return the same envelope.

```json
{
  "object": "list",
  "data": [ { "object": "auction", "id": "auc_3f9a2c7b1d4e" } ],
  "has_more": true,
  "next_cursor": "auc_3f9a2c7b1d4e"
}
```

Pass `next_cursor` as `starting_after` to get the next page. When `has_more` is `false`, `next_cursor` is `null` and you're done.

```bash
curl "$AUCTRA_URL/v1/auctions?limit=50&starting_after=auc_3f9a2c7b1d4e" \
  -H "Authorization: Bearer $AUCTRA_KEY"
```

`limit` is 1–100, default 25.

## Why not `?page=2`

Because auctions are created while you're paging through them.

Offset pagination asks "skip 25 rows, give me the next 25." If three auctions are created between your first request and your second, rows 23, 24 and 25 from page one shift down into page two — and you see them twice. If three are settled and filtered out instead, three auctions vanish from your results entirely, having never appeared on any page.

A cursor says "give me the 25 rows after *this specific object*." New rows landing elsewhere in the ordering change nothing. Nothing is skipped and nothing is duplicated, no matter how long you take.

Treat the cursor as opaque. Today it's an object id; tomorrow it might not be.

## Filtering `status` is a special case

`status` is derived from the chain clock at read time, not stored. An auction whose `end_time` passed four seconds ago is reported `ended` even though its database row still says `live`.

That means `?status=live` filters after the rows come out of the database. A page can therefore come back with fewer items than `limit` while `has_more` is still `true`. This is correct, not a bug. Page until `has_more` is false; don't stop early because a page looked short.

## Draining a list

```js
async function* allAuctions(params = {}) {
  let cursor = null;
  do {
    const url = new URL("/v1/auctions", AUCTRA_URL);
    Object.entries({ ...params, limit: 100 }).forEach(([k, v]) => url.searchParams.set(k, v));
    if (cursor) url.searchParams.set("starting_after", cursor);

    const page = await fetch(url, { headers: auth }).then((r) => r.json());
    yield* page.data;
    cursor = page.next_cursor;
  } while (cursor);
}
```

At 100 rows per request against a 100 req/min limit, a full drain of 10,000 auctions takes about a minute. If you find yourself doing that on a schedule, you want [webhooks](webhooks.html) or the [event log](api-reference.html#get-v1events) instead.
