import type { FastifyInstance, FastifyReply } from "fastify";
import { getStorage } from "../../storage/storage";

/** Streams objects served by the local storage driver (public/expiry-guarded). */
export function registerFilesRoutes(app: FastifyInstance) {
  app.get<{
    Params: { bucket: string };
    Querystring: { e?: string };
  }>("/files/:bucket/*", async (req, reply) => {
    const bucket = req.params.bucket;
    if (!["course-assets", "user-uploads", "public"].includes(bucket)) {
      return reply.status(400).send({ error: { code: "invalid_bucket", message: "Unknown bucket." } });
    }
    const key = (req.params as Record<string, string>)["*"] ?? "";
    if (!key || key.includes("..")) {
      return reply.status(400).send({ error: { code: "invalid_key", message: "Invalid object key." } });
    }
    const expiry = Number(req.query.e ?? 0);
    if (expiry > 0 && expiry < Date.now()) {
      return reply.status(410).send({ error: { code: "link_expired", message: "This link has expired." } });
    }
    const object = await getStorage().readObject(key, bucket as "course-assets" | "user-uploads" | "public");
    if (!object) {
      return reply.status(404).send({ error: { code: "not_found", message: "Object not found." } });
    }
    return sendBuffer(reply, object.data, object.contentType);
  });
}

function sendBuffer(reply: FastifyReply, data: Buffer, contentType: string) {
  reply.header("content-type", contentType);
  reply.header("cache-control", "public, max-age=604800");
  return reply.send(data);
}