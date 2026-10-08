import { db, fail } from "./supabase";
export type ProductDeletePreview = {
  id: string;
  code: string;
  updated_at: string;
  links: number;
  image_path: string | null;
  image_shared: boolean;
};
export async function cleanupDeletedProductImages() {
  const { data, error } = await db().rpc("admin_pending_image_cleanup");
  fail(error);
  let pending = 0;
  for (const path of (data ?? []) as string[]) {
    try {
      const before = await db().rpc("admin_finish_image_cleanup", {
        p_path: path,
      });
      fail(before.error);
      if (before.data) continue;
      const removed = await db().storage.from("product-images").remove([path]);
      fail(removed.error);
      const after = await db().rpc("admin_finish_image_cleanup", {
        p_path: path,
      });
      fail(after.error);
      if (!after.data) pending++;
    } catch {
      pending++;
    }
  }
  const remaining = await db().rpc("admin_pending_image_cleanup");
  fail(remaining.error);
  return Math.max(pending, ((remaining.data ?? []) as string[]).length);
}
