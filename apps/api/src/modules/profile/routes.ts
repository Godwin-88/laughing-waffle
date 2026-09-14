import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { INTEREST_OPTIONS, type InterestValue, type SkillLevel } from "@takwimu/shared";
import { completeWizardStep, updateBio, uploadAvatar } from "./service";

function interestOptions() {
  return INTEREST_OPTIONS.map((o) => o.value as string);
}

const wizardSchema = z.object({
  step: z.literal(1).or(z.literal(2)).or(z.literal(3)),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  interests: z.array(z.string()).optional(),
  experienceLevel: z.string().optional(),
});

const bioSchema = z.object({
  bio: z.string().max(500),
});

export function registerProfileRoutes(app: FastifyInstance) {
  // Profile wizard — one endpoint per step (US-1.2.1: name → interests → level)
  app.post<{ Body: unknown }>(
    "/profile/wizard",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = wizardSchema.parse(req.body);
      const user = await completeWizardStep(req.userId, {
        step: body.step,
        firstName: body.firstName,
        lastName: body.lastName,
        interests: (body.interests as InterestValue[] | undefined)?.filter((i) =>
          interestOptions().includes(i),
        ),
        experienceLevel: body.experienceLevel as SkillLevel | undefined,
      });
      return reply.send({ user });
    },
  );

  app.patch<{ Body: unknown }>(
    "/profile/bio",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { bio } = bioSchema.parse(req.body);
      const user = await updateBio(req.userId, bio);
      return reply.send({ user });
    },
  );

  app.post(
    "/profile/avatar",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const data = await req.file();
      if (!data) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "Missing avatar file.", fields: { avatar: "required" } },
        });
      }
      const bytes = Buffer.from(await data.toBuffer());
      const contentType = data.mimetype ?? "application/octet-stream";
      const url = await uploadAvatar(req.userId, bytes, contentType);
      return reply.send({ avatarUrl: url });
    },
  );
}