import { db, fail } from "./supabase";
export async function loadComponentTypes(): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db()
      .from("component_types")
      .select("name")
      .order("name")
      .range(offset, offset + 999);
    fail(error);
    names.push(...(data ?? []).map((row) => row.name));
    if ((data?.length ?? 0) < 1000) return names;
  }
}
