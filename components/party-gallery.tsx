"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PartyHeader } from "./party-header";
import { PhotoCard } from "./photo-card";
import { Lightbox } from "./lightbox";
import { UploadButton } from "./upload-button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";

export function PartyGallery({ code, title, expiresAt, role, currentProfileId }: {
  code: string; title: string; expiresAt: number; role: "host" | "member"; currentProfileId: string | null;
}) {
  const r = useRouter();
  const { toast } = useToast();
  const [photos, setPhotos] = useState<any[] | null>(null);
  const [selIndex, setSelIndex] = useState<number | null>(null);
  const [optimisticLoves, setOptimisticLoves] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/photos?party=${code}`);
    if (res.status === 403) { r.push(`/j/${code}`); return; }
    if (res.ok) {
      const data = await res.json();
      setPhotos(data.photos);
    } else {
      setPhotos([]);
    }
  }, [code, r]);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("photohere:reload", handler);
    return () => window.removeEventListener("photohere:reload", handler);
  }, [load]);

  async function toggleLike(id: string, liked: boolean) {
    setOptimisticLoves((p) => ({ ...p, [id]: !liked }));
    const method = liked ? "DELETE" : "POST";
    await fetch("/api/like", method === "POST" ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId: id }),
    } : { method: "DELETE" });
    setOptimisticLoves((p) => ({}));
    load();
  }

  async function deletePhoto(id: string) {
    const r = await fetch("/api/photo/delete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (r.ok) {
      setPhotos((p) => p ? p.filter((x) => x.id !== id) : p);
      setSelIndex(null);
      toast({ title: "Photo deleted" });
    }
  }

  const selPhoto = selIndex !== null && photos ? photos[selIndex] : null;
  const computeLiked = (p: any) => optimisticLoves[p.id] ?? p.liked;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <PartyHeader code={code} title={title} expiresAt={expiresAt} role={role} />
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{photos ? `${photos.length} photos` : "Loading…"}</h2>
        <UploadButton partyCode={code} />
      </div>
      {photos === null ? (
        <div className="columns-2 md:columns-3 lg:columns-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[4/3] mb-3 rounded-xl" />)}
        </div>
      ) : photos.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">No photos yet. Be the first to upload.</div>
      ) : (
        <div className="columns-2 md:columns-3 lg:columns-4 gap-3">
          {photos.map((p, i) => (
            <PhotoCard
              key={p.id}
              photo={{ ...p, liked: computeLiked(p) }}
              onOpen={() => setSelIndex(i)}
              onLike={() => toggleLike(p.id, p.liked)}
            />
          ))}
        </div>
      )}
      <Lightbox
        photo={selPhoto ? { ...selPhoto, liked: computeLiked(selPhoto) } : null}
        onClose={() => setSelIndex(null)}
        onLike={(id) => toggleLike(id, selPhoto!.liked)}
        onDelete={currentProfileId && selPhoto && selPhoto.uploaderProfileId === currentProfileId ? deletePhoto : undefined}
        isAuthor={!!currentProfileId && !!selPhoto && selPhoto.uploaderProfileId === currentProfileId}
      />
    </main>
  );
}
