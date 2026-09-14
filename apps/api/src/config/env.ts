import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Environment configuration with local .env discovery.
 * Looks for apps/api/.env first, then the repo-root .env (used by docker compose).
 */
export interface Env {
  NODE_ENV: string;
  DATABASE_URL: string;
  REDIS_URL: string | null;
  API_PORT: number;
  PUBLIC_API_URL: string;
  WEB_ORIGIN: string;
  JWT_SECRET: string;
  JWT_ACCESS_TTL: string;
  JWT_REFRESH_TTL_DAYS: number;
  COOKIE_SECURE: boolean;
  SMTP_URL: string | null;
  SMTP_FROM: string;
  STORAGE_DRIVER: "auto" | "b2" | "local";
  B2_ENDPOINT: string | null;
  B2_BUCKET_COURSE_ASSETS: string;
  B2_BUCKET_USER_UPLOADS: string;
  B2_BUCKET_PUBLIC: string;
  B2_KEY_ID: string | null;
  B2_APP_KEY: string | null;
  GOOGLE_CLIENT_ID: string | null;
  GOOGLE_CLIENT_SECRET: string | null;
  MICROSOFT_CLIENT_ID: string | null;
  MICROSOFT_CLIENT_SECRET: string | null;
}

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."); // apps/api
const MONOREPO_ROOT = path.resolve(API_ROOT, ".."); // lms-platform

function loadDotEnvFiles() {
  if (typeof process.loadEnvFile !== "function") return;
  const candidates = [
    path.join(API_ROOT, ".env"),
    path.join(MONOREPO_ROOT, ".env"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        process.loadEnvFile(file);
      } catch (err) {
        console.warn(`[env] could not load ${file}:`, err);
      }
    }
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === "" ? null : value;
}

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  loadDotEnvFiles();

  const jwtSecret = required("JWT_SECRET");
  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in development");
  }

  const storageDriver = optional("STORAGE_DRIVER") ?? "auto";
  const hasB2 = Boolean(optional("B2_KEY_ID") && optional("B2_APP_KEY"));
  const effectiveDriver: Env["STORAGE_DRIVER"] =
    storageDriver === "b2" || storageDriver === "local" || storageDriver === "auto"
      ? (storageDriver === "auto" ? (hasB2 ? "b2" : "local") : storageDriver)
      : (hasB2 ? "b2" : "local");

  cached = {
    NODE_ENV: optional("NODE_ENV") ?? "development",
    DATABASE_URL: required("DATABASE_URL"),
    REDIS_URL: optional("REDIS_URL"),
    API_PORT: Number(optional("API_PORT") ?? 4000),
    PUBLIC_API_URL: (optional("PUBLIC_API_URL") ?? "http://localhost:4000").replace(/\/$/, ""),
    WEB_ORIGIN: (optional("WEB_ORIGIN") ?? "http://localhost:3000").replace(/\/$/, ""),
    JWT_SECRET: jwtSecret,
    JWT_ACCESS_TTL: optional("JWT_ACCESS_TTL") ?? "15m",
    JWT_REFRESH_TTL_DAYS: Number(optional("JWT_REFRESH_TTL_DAYS") ?? 30),
    COOKIE_SECURE: (optional("COOKIE_SECURE") ?? "false") === "true",
    SMTP_URL: optional("SMTP_URL"),
    SMTP_FROM: optional("SMTP_FROM") ?? "Takwimu Data School <no-reply@takwimu.school>",
    STORAGE_DRIVER: effectiveDriver,
    B2_ENDPOINT: optional("B2_ENDPOINT"),
    B2_BUCKET_COURSE_ASSETS: optional("B2_BUCKET_COURSE_ASSETS") ?? "lms-course-assets",
    B2_BUCKET_USER_UPLOADS: optional("B2_BUCKET_USER_UPLOADS") ?? "lms-user-uploads",
    B2_BUCKET_PUBLIC: optional("B2_BUCKET_PUBLIC") ?? "lms-public",
    B2_KEY_ID: optional("B2_KEY_ID"),
    B2_APP_KEY: optional("B2_APP_KEY"),
    GOOGLE_CLIENT_ID: optional("GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: optional("GOOGLE_CLIENT_SECRET"),
    MICROSOFT_CLIENT_ID: optional("MICROSOFT_CLIENT_ID"),
    MICROSOFT_CLIENT_SECRET: optional("MICROSOFT_CLIENT_SECRET"),
  };
  return cached!;
}