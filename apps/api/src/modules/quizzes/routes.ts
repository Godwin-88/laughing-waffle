import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { QuizSubmissionPayload } from "@takwimu/shared";
import { onProgressEvent } from "../../lib/progress-events";
import { unauthorized } from "../../lib/errors";
import { verifyAccessToken } from "../../lib/tokens";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { users } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getQuizStatus, startQuizAttempt, submitQuizAttempt } from "./service";
import { notifyQuizGraded } from "../notifications/service";

async function authenticateSse(req: FastifyRequest): Promise<string> {
  const header = req.headers.authorization;
  const queryToken = (req.query as { token?: string }).token;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;
  if (!token) throw unauthorized("Authentication required.");
  const env = loadEnv();
  let claims;
  try {
    claims = await verifyAccessToken(env.JWT_SECRET, token);
  } catch {
    throw unauthorized("Session expired. Please sign in again.");
  }
  const { db } = getDb(env.DATABASE_URL);
  const rows = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, claims.sub)).limit(1);
  if (rows.length === 0 || rows[0].status !== "active") {
    throw unauthorized("This account is no longer active.");
  }
  return rows[0].id;
}

export function registerQuizRoutes(app: FastifyInstance) {
  app.get<{ Params: { slug: string; position: string } }>(
    "/courses/:slug/lessons/:position/quiz/status",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const result = await getQuizStatus(req.userId, req.params.slug, Number(req.params.position));
      return reply.send(result);
    },
  );

  app.post<{ Params: { slug: string; position: string } }>(
    "/courses/:slug/lessons/:position/quiz/attempts",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const result = await startQuizAttempt(req.userId, req.params.slug, Number(req.params.position));
      return reply.send(result);
    },
  );

  app.post<{ Params: { slug: string; position: string; attemptId: string } }>(
    "/courses/:slug/lessons/:position/quiz/attempts/:attemptId/submit",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = z
        .object({
          answers: z.array(
            z.object({ questionId: z.string().uuid(), selectedIndex: z.number().int().min(0) }),
          ),
        })
        .parse(req.body) as QuizSubmissionPayload;
      const result = await submitQuizAttempt(
        req.userId,
        req.params.slug,
        Number(req.params.position),
        req.params.attemptId,
        body.answers,
      );
      // US-10.1.1 — "assignment graded" notification after the gradebook write.
      void notifyQuizGraded({
        userId: req.userId,
        courseSlug: req.params.slug,
        lessonPosition: Number(req.params.position),
        percent: result.gradebook.percent,
        passed: result.gradebook.passed,
      });
      return reply.send(result);
    },
  );
}

/**
 * US-5.1.1 — real-time progress stream via Server-Sent Events.
 * EventSource cannot send an Authorization header, so the access token is also
 * accepted via ?token= (in addition to Bearer). Registered under /api/v1.
 */
export function registerProgressEventsRoute(app: FastifyInstance) {
  app.get("/me/progress/events", async (req, reply) => {
    const userId = await authenticateSse(req);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.flushHeaders();

    const send = (payload: unknown) => {
      raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    send({ type: "connected", userId });

    const off = onProgressEvent(userId, (message) => send(message));

    const heartbeat = setInterval(() => {
      try {
        raw.write(": ping\n\n");
      } catch {
        cleanup();
      }
    }, 25_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      off();
      try {
        raw.end();
      } catch {
        /* already closed */
      }
    };

    raw.on("close", cleanup);
    raw.on("error", cleanup);

    // Keep the connection open until the client disconnects — Fastify would
    // otherwise consider the handler complete and end the reply.
    await new Promise<void>((resolve) => {
      raw.once("close", () => resolve());
      raw.once("error", () => resolve());
    });
  });
}