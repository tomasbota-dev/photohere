"use client";
import { useEffect, useRef, useState } from "react";
import { Heart, MessageCircle } from "lucide-react";

export function PhotoCard({ photo, onOpen, onLike }: { photo: any; onOpen: () => void; onLike: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(async (entries) => {
      if (entries[0].isIntersecting && !url && !loading) {
        setLoading(true);
        const r = await fetch(`/api/photo-url?id=${photo.id}`);
        const data = await r.json();
        setUrl(data.url);
        setLoading(false);
        obs.disconnect();
      }
    }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [photo.id, url, loading]);

  return (
    <div ref={ref} className="break-inside-avoid mb-3 group relative">
      <div className="w-full aspect-[var(--ar)] bg-muted rounded-xl overflow-hidden cursor-pointer" style={{ aspectRatio: photo.width && photo.height ? `${photo.width}/${photo.height}` : "4/3" }} onClick={onOpen}>
        {url ? (
          <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover transition group-hover:scale-[1.02]" />
        ) : (
          <div className="w-full h-full animate-pulse" />
        )}
      </div>
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
        <button onClick={onLike} className={`p-1.5 rounded-full bg-black/60 backdrop-blur text-white ${photo.liked ? "text-rose-400" : ""}`}>
          <Heart className="w-4 h-4" fill={photo.liked ? "currentColor" : "none"} />
        </button>
        <span className="px-1.5 py-1.5 rounded-full bg-black/60 backdrop-blur text-white text-xs flex items-center gap-1">
          <MessageCircle className="w-3 h-3" /> {photo.commentCount}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition">
        {photo.likeCount > 0 && <>{photo.likeCount} likes</>}
      </div>
    </div>
  );
}
