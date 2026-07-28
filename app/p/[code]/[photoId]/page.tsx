import { redirect } from "next/navigation";

export const runtime = "edge";

export default async function PhotoPage({ params }: { params: Promise<{ code: string; photoId: string }> }) {
  const { code } = await params;
  redirect(`/p/${code}`);
}
