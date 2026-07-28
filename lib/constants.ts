export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PARTY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const UPLOAD_URL_TTL_SEC = 5 * 60;
export const READ_URL_TTL_SEC = 10 * 60;
export const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
export const RATE_LIMIT_UPLOADS_PER_MIN = 10;

const BASE32_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export function generatePartyCode(len = 6): string {
  let s = "";
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  for (let i = 0; i < len; i++) s += BASE32_ALPHABET[a[i] % BASE32_ALPHABET.length];
  return s;
}
