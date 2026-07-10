import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AuctraError, errors } from "../lib/errors.js";
import { env } from "../lib/env.js";

const DOCS = "https://docs.auctra.dev";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | AuctraError, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = req.id;

    if (err instanceof AuctraError) {
      return reply.code(err.statusCode).send(err.toJSON(requestId, DOCS));
    }

    if (err instanceof ZodError) {
      const first = err.issues[0];
      const mapped = errors.validation(first?.message ?? "Invalid request.", first?.path.join("."));
      return reply.code(mapped.statusCode).send(mapped.toJSON(requestId, DOCS));
    }

    if ((err as FastifyError).statusCode === 429) {
      const mapped = new AuctraError({
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
        message: "Too many requests. Back off and retry after the interval in Retry-After.",
      });
      return reply.code(429).send(mapped.toJSON(requestId, DOCS));
    }

    req.log.error({ err, requestId }, "unhandled_error");

    // Never leak a stack trace or an RPC provider's URL to a caller.
    return reply.code(500).send({
      error: {
        type: "api_error",
        code: "internal_error",
        message:
          env.NODE_ENV === "development"
            ? err.message
            : "Something went wrong on our side. This request was not processed.",
        request_id: requestId,
        docs_url: `${DOCS}/errors#internal_error`,
      },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: {
        type: "invalid_request_error",
        code: "unknown_endpoint",
        message: `${req.method} ${req.url} is not an Auctra endpoint.`,
        request_id: req.id,
        docs_url: `${DOCS}/api-reference`,
      },
    });
  });
}
