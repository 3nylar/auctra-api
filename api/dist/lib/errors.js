const STATUS_BY_TYPE = {
    authentication_error: 401,
    permission_error: 403,
    invalid_request_error: 400,
    chain_error: 422,
    idempotency_error: 409,
    rate_limit_error: 429,
    api_error: 500,
};
export class AuctraError extends Error {
    type;
    code;
    param;
    statusCode;
    detail;
    constructor(opts) {
        super(opts.message);
        this.name = "AuctraError";
        this.type = opts.type;
        this.code = opts.code;
        this.param = opts.param;
        this.detail = opts.detail;
        this.statusCode = opts.status ?? STATUS_BY_TYPE[opts.type];
    }
    toJSON(requestId, docsBase) {
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
    unauthenticated: (message = "No API key provided.") => new AuctraError({ type: "authentication_error", code: "missing_api_key", message }),
    invalidKey: () => new AuctraError({
        type: "authentication_error",
        code: "invalid_api_key",
        message: "The API key provided is invalid or has been revoked.",
    }),
    wrongEnvironment: (given) => new AuctraError({
        type: "authentication_error",
        code: "environment_mismatch",
        message: `A ${given} key was used against the ${given === "sk_live_" ? "sandbox" : "production"} host. Keys are not portable across environments.`,
    }),
    missingScope: (scope) => new AuctraError({
        type: "permission_error",
        code: "insufficient_scope",
        message: `This key is missing the "${scope}" scope.`,
    }),
    invalidCredentials: () => new AuctraError({
        type: "authentication_error",
        code: "invalid_credentials",
        message: "Incorrect email or password.",
    }),
    emailTaken: () => new AuctraError({
        type: "invalid_request_error",
        code: "email_taken",
        message: "An account with this email already exists.",
        param: "email",
    }),
    notFound: (resource, ref) => new AuctraError({
        type: "invalid_request_error",
        code: "resource_not_found",
        message: `No ${resource} with id "${ref}".`,
        status: 404,
    }),
    validation: (message, param) => new AuctraError({ type: "invalid_request_error", code: "parameter_invalid", message, param }),
    bidBelowMinimum: (minWei) => new AuctraError({
        type: "invalid_request_error",
        code: "bid_below_minimum",
        message: "Bid does not clear the current minimum.",
        param: "amount_wei",
        detail: { minimum_bid_wei: minWei },
    }),
    auctionNotLive: (status) => new AuctraError({
        type: "invalid_request_error",
        code: "auction_not_live",
        message: `Auction is ${status} and is no longer accepting bids.`,
    }),
    auctionHasBids: () => new AuctraError({
        type: "invalid_request_error",
        code: "auction_has_bids",
        message: "An auction cannot be cancelled once a bid has been placed.",
    }),
    auctionNotEnded: (endsAt) => new AuctraError({
        type: "invalid_request_error",
        code: "auction_not_ended",
        message: `Auction cannot be settled before ${endsAt}.`,
    }),
    idempotencyConflict: () => new AuctraError({
        type: "idempotency_error",
        code: "idempotency_key_reused",
        message: "This Idempotency-Key was already used with a different request body. Use a new key.",
    }),
    idempotencyInFlight: () => new AuctraError({
        type: "idempotency_error",
        code: "idempotency_request_in_flight",
        message: "A request with this Idempotency-Key is still being processed. Retry shortly.",
    }),
    managedSignerDisabled: () => new AuctraError({
        type: "invalid_request_error",
        code: "managed_signer_disabled",
        message: 'mode="managed" requires a configured signer. Use mode="prepared" and sign the returned transaction yourself.',
        param: "mode",
    }),
    chainReverted: (reason) => new AuctraError({
        type: "chain_error",
        code: "transaction_reverted",
        message: `The chain rejected this transaction: ${reason}`,
    }),
    rpcUnavailable: () => new AuctraError({
        type: "api_error",
        code: "rpc_unavailable",
        message: "Unable to reach an RPC node. This is on us — retry with backoff.",
        status: 503,
    }),
};
