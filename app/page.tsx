import Link from "next/link";
import { Button } from "@/components/ui/button";
import { JoinForm } from "@/components/join-form";

export default function Home() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-24 space-y-16">
        <section className="max-w-2xl space-y-8">
          <h1 className="text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
            Every photo from everyone. <span className="text-muted-foreground">One link.</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Create a party. Share the code. Guests upload, like, comment and download. Auto-deletes in 90 days.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/create"><Button size="lg">Create a party</Button></Link>
          </div>
        </section>

        <section className="max-w-md space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">Have a code?</h2>
          <JoinForm />
        </section>
      </div>
    </main>
  );
}
