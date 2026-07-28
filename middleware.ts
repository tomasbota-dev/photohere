import { NextResponse, type NextRequest } from "next/server";

const PROFILE_COOKIE = "ph_profile";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get(PROFILE_COOKIE)?.value) {
    res.cookies.set(PROFILE_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!api/cron|_next/static|_next/image|favicon.ico).*)"],
};
