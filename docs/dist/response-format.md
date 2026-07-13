# Response format

# Response format

Every endpoint in this API returns one of three shapes. Once you know them, you can predict the response of an endpoint you haven't called yet.

## A single object

Returned by `GET` on a single resource, and by most `POST` actions that mutate one resource (create an auction, place a bid, settle, cancel, claim).

```json
{
  "object": "auction",
  "id": "auc_3f9a2c7b1d4e",
  ...
}
```

`object` names the resource type (`auction`, `bid`, `refund`, `transaction`, `webhook_endpoint`, `event`, `health`). Check it before you assume a response's shape — it's cheaper than a type guard on every field.

## A list

Returned by every `GET` that browses a collection (`/v1/auctions`, `/v1/auctions/{id}/bids`, `/v1/refunds`, `/v1/events`, `/v1/webhook_endpoints`).

```json
{
  "object": "list",
  "data": [ { "object": "auction", ... } ],
  "has_more": false,
  "next_cursor": null
}
```

Pagination is cursor-based, not offset-based — see [Pagination](/pagination.html) for why. Pass `next_cursor` back as `starting_after` to get the next page; stop when `has_more` is `false`.

## An error

Returned whenever the HTTP status is 4xx or the request was rejected before it reached the chain.

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "bid_below_minimum",
    "message": "Bid does not clear the current minimum.",
    "param": "amount_wei",
    "detail": { "minimum_bid_wei": "1102500000000000000" },
    "request_id": "req_9f2ac71b3d8e4a05",
    "docs_url": "https://docs.auctra.dev/errors#bid_below_minimum"
  }
}
```

`code` is the stable identifier to branch your code on — `message` is for humans and can change wording without notice. See [Errors](/errors.html) for the full code list.

## What's never true

Auctra does not wrap single objects or errors in a `data` envelope, and does not use HTTP status `200` for errors with a body describing failure — the status code is always authoritative. If you're only checking `response.ok`, you already have everything you need to route the other two shapes.
