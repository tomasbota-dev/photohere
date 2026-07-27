"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heart, Download, Trash2 } from "lucide-react";

interface LightboxProps {
  photo: any | null;
  onClose: () => void;
  onLike: (id: string) => void;
  onDelete?: (id: string) => void;
  isAuthor: boolean;
}

export function Lightbox({ photo, onClose, onLike, onDelete, isAuthor }: LightboxProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [dlUrl, setDlUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!photo) return;
    setUrl(null); setDlUrl(null); setComments([]);
    (async () => {
      const r1 = await fetch(`/api/photo-url?id=${photo.id}`);
      setUrl((await r1.json()).url);
      const r2 = await fetch(`/api/comment?photoId=${photo.id}`);
      setComments((await r2.json()).comments);
    })();
  }, [photo?.id]);

  async function doDownload() {
    if (!dlUrl) {
      const r = await fetch(`/api/photo-download?id=${photo.id}`);
      setDlUrl((await r.json()).url);
    }
    if (dlUrl) window.location.href = dlUrl;
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    const r = await fetch("/api/comment", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId: photo.id, body: body.trim() }),
    });
    if (r.ok) {
      const c = await r.json();
      setComments((p) => [c, ...p]);
      setBody("");
    }
  }

  return (
    <Dialog open={!!photo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden">
        {photo && (
          <div className="grid md:grid-cols-[2fr_1fr] max-h-[85vh]">
            <div className="bg-black flex items-center justify-center min-h-[300px]">
              {url ? <img src={url} alt="" className="max-h-[85vh] max-w-full object-contain" /> : <div className="w-full h-full animate-pulse" />}
            </div>
            <div className="flex flex-col p-4 gap-3 overflow-hidden">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => onLike(photo.id)} className={photo.liked ? "text-rose-500" : ""}>
                  <Heart fill={photo.liked ? "currentColor" : "none"} className="w-4 h-4" />&nbsp;{photo.likeCount}
                </Button>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={doDownload}><Download className="w-4 h-4" /></Button>
                  {isAuthor && onDelete && (
                    <Button variant="ghost" size="sm" onClick={() => onDelete(photo.id)} className="text-red-500"><Trash2 className="w-4 h-4" /></Button>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{photo.uploaderNickname ?? "Someone"} · {(photo.bytes / 1024).toFixed(0)} KB</div>
              <form onSubmit={addComment} className="flex gap-2">
                <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" maxLength={500} />
                <Button type="submit" size="sm">Send</Button>
              </form>
              <div className="overflow-y-auto flex-1 space-y-2">
                {comments.map((c) => (
                  <div key={c.id} className="text-sm">
                    <div className="font-medium">{c.profileNickname ?? "Someone"}</div>
                    <div>{escapeHtml(c.body)}</div>
                  </div>
                ))}
                {comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet.</div>}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
