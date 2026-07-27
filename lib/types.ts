export interface PartySummary {
  id: string;
  code: string;
  title: string;
  role: "host" | "member";
  createdAt: number;
  expiresAt: number;
}

export interface PhotoRow {
  id: string;
  partyId: string;
  uploaderProfileId: string;
  uploaderNickname: string | null;
  r2Key: string;
  width: number | null;
  height: number | null;
  bytes: number;
  contentType: string;
  createdAt: number;
  liked: boolean;
  likeCount: number;
  commentCount: number;
}

export interface CommentRow {
  id: string;
  photoId: string;
  profileId: string;
  profileNickname: string | null;
  body: string;
  createdAt: number;
}
