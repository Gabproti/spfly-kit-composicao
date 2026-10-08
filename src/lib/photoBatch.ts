import { duplicateTargets, type PhotoProduct } from "./photoRules";
export type PhotoChoice = "upload" | "keep" | "skip" | "";
type BatchRow = {
  target?: PhotoProduct;
  choice: PhotoChoice;
  source: { error: string };
  done?: boolean;
};
export function applyExistingChoice<T extends BatchRow>(
  rows: T[],
  choice: "keep" | "upload",
): T[] {
  return rows.map((r) =>
    !r.done && !r.source.error && r.choice !== "skip" && r.target?.image_url
      ? { ...r, choice }
      : r,
  );
}
export function batchConflicts(rows: BatchRow[]) {
  return duplicateTargets(
    rows.map((r) => ({
      target: r.target,
      ignored: Boolean(
        r.done || r.source.error || r.choice === "keep" || r.choice === "skip",
      ),
    })),
  );
}
export function readyPhoto(row: BatchRow, conflicts: Set<string>) {
  return (
    !row.done &&
    !row.source.error &&
    Boolean(row.target) &&
    row.choice === "upload" &&
    !conflicts.has(row.target!.id)
  );
}
// A conflicting image is excluded from this confirmed batch, never chosen arbitrarily.
export function preparePhotoBatch<T extends BatchRow>(rows: T[]): T[] {
  const conflicts = batchConflicts(rows);
  return rows.map((r) =>
    !r.done &&
    r.target &&
    r.choice !== "keep" &&
    r.choice !== "skip" &&
    conflicts.has(r.target.id)
      ? { ...r, choice: "skip" }
      : r,
  );
}
