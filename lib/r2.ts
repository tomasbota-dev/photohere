import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "./db";
import { UPLOAD_URL_TTL_SEC, READ_URL_TTL_SEC } from "./constants";

export function getR2Client(env: Env): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export async function presignPut(env: Env, key: string, contentType: string, contentLength: number): Promise<string> {
  const client = getR2Client(env);
  const cmd = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, cmd, { expiresIn: UPLOAD_URL_TTL_SEC });
}

export async function presignGet(env: Env, key: string, download = false): Promise<string> {
  const client = getR2Client(env);
  const cmd = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ...(download ? { ResponseContentDisposition: `attachment; filename="${encodeURIComponent(key.split("/").pop()!)}"` } : {}),
  });
  return getSignedUrl(client, cmd, { expiresIn: READ_URL_TTL_SEC });
}
