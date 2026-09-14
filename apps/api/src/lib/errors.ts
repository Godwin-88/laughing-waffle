import type { FastifyError, FastifyInstance } from "fastify";

/** Application error with HTTP status + machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function badRequest(message: string, fields?: Record<string, string>) {
  return new ApiError(400, "validation_error", message, fields);
}

export function unauthorized(message = "Authentication required.") {
  return new ApiError(401, "unauthorized", message);
}

export function forbidden(message = "You do not have permission to do that.") {
  return new ApiError(403, "forbidden", message);
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
    return reply.status(status).send({ error: { code, message: error.message, ...(err.fields ? { fields: err.fields } : {}) } });
  });
}