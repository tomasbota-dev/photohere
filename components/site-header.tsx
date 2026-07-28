import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";

export interface HeaderProfile {
  email: string | null;
  isAnonymous: boolean;
}

export function SiteHeader({ profile }: { profile: HeaderProfile | null }) {
  const signedIn = profile && !profile.isAnonymous;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="font-mono text-sm tracking-tight">photohere</Link>
        <div className="flex items-center gap-3">
          <Link href="/me" className="text-sm text-muted-foreground hover:text-foreground transition-colors">My parties</Link>
          {signedIn ? (
            <span className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground max-w-[12rem] truncate">{profile!.email}</span>
              <SignOutButton />
            </span>
          ) : (
            <Link href="/auth/request" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Sign in</Link>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
