/**
 * A single error shape, everywhere. Clients should switch on `code`, never on
 * the human-readable `message` — messages are free to change, codes are not.
 *
 *   { "error": { "type": "invalid_request_error",
 *                "code": "bid_below_minimum",
 *                "message": "Bid must exceed 1.05 ETH.",
 *                "param": "amount_wei",
 *                "request_id": "req_9f2a...",
 *                "docs_url": "https://auctra-api.vercel.app/errors#bid_below_minimum" } }
 */
export type ErrorType =
  | "authentication_error"
  | "permission_error"
  | "invalid_request_error"
  | "chain_error"
  | "idempotency_error"
  | "rate_limit_error"
  | "api_error";

const STATUS_BY_TYPE: Record<ErrorType, number> = {
  authentication_error: 401,
  permission_error: 403,
  invalid_request_error: 400,
  chain_error: 422,
  idempotency_error: 409,
  rate_limit_error: 429,
  api_error: 500,
};

export class AuctraError extends Error {
  readonly type: ErrorType;
  readonly code: string;
  readonly param?: string;
  readonly statusCode: number;
  readonly detail?: Record<string, unknown>;

  constructor(opts: {
    type: ErrorType;
    code: string;
    message: string;
    param?: string;
    status?: number;
    detail?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = "AuctraError";
    this.type = opts.type;
    this.code = opts.code;
    this.param = opts.param;
    this.detail = opts.detail;
    this.statusCode = opts.status ?? STATUS_BY_TYPE[opts.type];
  }

  toJSON(requestId: string, docsBase: string) {
    return {
      error: {
        type: this.type,
        code: this.code,
        message: this.message,
        ...(this.param ? { param: this.param } : {}),
        ...(this.detail ? { detail: this.detail } : {}),
        request_id: requestId,
        docs_url: `${docsBase}/errors#${this.code}`,
      },
    };
  }
}

/** Shorthand constructors for the errors we raise most. */
export const errors = {
  unauthenticated: (message = "No API key provided.") =>
    new AuctraError({ type: "authentication_error", code: "missing_api_key", message }),

  invalidKey: () =>
    new AuctraError({
      type: "authentication_error",
      code: "invalid_api_key",
      message: "The API key provided is invalid or has been revoked.",
    }),

  wrongEnvironment: (given: string) =>
    new AuctraError({
      type: "authentication_error",
      code: "environment_mismatch",
      message: `A ${given} key was used against the ${
        given === "sk_live_" ? "sandbox" : "production"
      } host. Keys are not portable across environments.`,
    }),

  missingScope: (scope: string) =>
    new AuctraError({
      type: "permission_error",
      code: "insufficient_scope",
      message: `This key is missing the "${scope}" scope.`,
    }),

  notFound: (resource: string, ref: string) =>
    new AuctraError({
      type: "invalid_request_error",
      code: "resource_not_found",
      message: `No ${resource} with id "${ref}".`,
      status: 404,
    }),

  validation: (message: string, param?: string) =>
    new AuctraError({ type: "invalid_request_error", code: "parameter_invalid", message, param }),

  bidBelowMinimum: (minWei: string) =>
    new AuctraError({
      type: "invalid_request_error",
      code: "bid_below_minimum",
      message: "Bid does not clear the current minimum.",
      param: "amount_wei",
      detail: { minimum_bid_wei: minWei },
    }),

  auctionNotLive: (status: string) =>
    new AuctraError({
      type: "invalid_request_error",
      code: "auction_not_live",
      message: `Auction is ${status} and is no longer accepting bids.`,
    }),

  auctionHasBids: () =>
    new AuctraError({
      type: "invalid_request_error",
      code: "auction_has_bids",
      message: "An auction cannot be cancelled once a bid has been placed.",
    }),

  auctionNotEnded: (endsAt: string) =>
    new AuctraError({
      type: "invalid_request_error",
      code: "auction_not_ended",
      message: `Auction cannot be settled before ${endsAt}.`,
    }),

  idempotencyConflict: () =>
    new AuctraError({
      type: "idempotency_error",
      code: "idempotency_key_reused",
      message:
        "This Idempotency-Key was already used with a different request body. Use a new key.",
    }),

  idempotencyInFlight: () =>
    new AuctraError({
      type: "idempotency_error",
      code: "idempotency_request_in_flight",
      message: "A request with this Idempotency-Key is still being processed. Retry shortly.",
    }),

  managedSignerDisabled: () =>
    new AuctraError({
      type: "invalid_request_error",
      code: "managed_signer_disabled",
      message:
        'mode="managed" requires a configured signer. Use mode="prepared" and sign the returned transaction yourself.',
      param: "mode",
    }),

  chainReverted: (reason: string) =>
    new AuctraError({
      type: "chain_error",
      code: "transaction_reverted",
      message: `The chain rejected this transaction: ${reason}`,
    }),

  rpcUnavailable: () =>
    new AuctraError({
      type: "api_error",
      code: "rpc_unavailable",
      message: "Unable to reach an RPC node. This is on us — retry with backoff.",
      status: 503,
    }),
};
