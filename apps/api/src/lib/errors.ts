import type { FastifyError, FastifyInstance } from "fastify";

/** Application error with HTTP status + machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  /** Optional response headers (e.g. `Retry-After` on 429). */
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }
}

export function badRequest(
  message: string,
  codeOrFields?: string | Record<string, string>,
  fields?: Record<string, string>,
) {
  if (typeof codeOrFields === "string") {
    return new ApiError(400, codeOrFields, message, fields);
  }
  return new ApiError(400, "validation_error", message, codeOrFields);
}

export function unauthorized(message = "Authentication required.", code = "unauthorized") {
  return new ApiError(401, code, message);
}

export function forbidden(message = "You do not have permission to do that.", code = "forbidden") {
  return new ApiError(403, code, message);
}

export function notFound(message = "Not found.") {
  return new ApiError(404, "not_found", message);
}

export function conflict(message: string, code = "conflict") {
  return new ApiError(409, code, message);
}

export function serviceUnavailable(message: string, code = "service_unavailable") {
  return new ApiError(503, code, message);
}

export function tooManyRequests(message: string, code = "rate_limit_exceeded", headers?: Record<string, string>) {
  return new ApiError(429, code, message, undefined, headers);
}

/** Register the global error handler so every error renders `{ error: { code, message } }`. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, _req, reply) => {
    const err = error as ApiError;
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
    const code = err.code || (status === 500 ? "internal_error" : "error");

    if (status >= 500) {
      app.log.error({ err: error, status }, `unhandled: ${error.message}`);
    }
    if (status >= 500 && process.env.NODE_ENV !== "development") {
      return reply.status(status).send({ error: { code, message: "Something went wrong. Please try again later." } });
    }
    if (err.headers) {
      for (const [k, v] of Object.entries(err.headers)) reply.header(k, v);
    }
    return reply.status(status).send({ error: { code, message: error.message, ...(err.fields ? { fields: err.fields } : {}) } });
  });
}