import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = () => sql`(unixepoch() * 1000)`;

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  nickname: text("nickname"),
  createdAt: integer("created_at").notNull().default(now),
  isAnonymous: integer("is_anonymous").notNull().default(1),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  profileId: text("profile_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const magicLinks = sqliteTable("magic_links", {
  tokenHash: text("token_hash").primaryKey(),
  profileId: text("profile_id").notNull(),
  email: text("email").notNull(),
  expiresAt: integer("expires_at").notNull(),
  used: integer("used").notNull().default(0),
});

export const parties = sqliteTable("parties", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  hostProfileId: text("host_profile_id").notNull(),
  createdAt: integer("created_at").notNull().default(now),
  expiresAt: integer("expires_at").notNull(),
});

export const partyMembers = sqliteTable("party_members", {
  partyId: text("party_id").notNull(),
  profileId: text("profile_id").notNull(),
  role: text("role").notNull(),
  joinedAt: integer("joined_at").notNull().default(now),
}, (t) => [primaryKey({ columns: [t.partyId, t.profileId] })]);

export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(),
  partyId: text("party_id").notNull(),
  uploaderProfileId: text("uploader_profile_id").notNull(),
  r2Key: text("r2_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  bytes: integer("bytes").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

export const likes = sqliteTable("likes", {
  photoId: text("photo_id").notNull(),
  profileId: text("profile_id").notNull(),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => [primaryKey({ columns: [t.photoId, t.profileId] })]);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  photoId: text("photo_id").notNull(),
  profileId: text("profile_id").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});
