/// <reference types="@cloudflare/workers-types" />
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export interface Env {
  DB: D1Database;
  PHOTOS_BUCKET: R2Bucket;
  AUTH_SECRET: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  APP_URL: string;
  CRON_SECRET: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME: string;
  ASSETS?: Fetcher;
}

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}
