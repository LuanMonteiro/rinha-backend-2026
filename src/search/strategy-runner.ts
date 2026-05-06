import type { LoadedDataset } from "../types";
import type { GridIndexV2 as GridIndex } from "../grid-v2";
import { knn5 as knn5S0 } from "../searcher";
import { knn5_s3 as knn5S3 } from "../search-s3";
import { knn5_s3b as knn5S3b } from "../search-s3b";
import { knn5 as knn5Prod } from "../search-prod";

export type SearchStrategy = "S0" | "S3" | "S3B" | "S5";

export function resolveStrategy(raw: string | undefined): SearchStrategy {
  const value = (raw || "S3B").trim().toUpperCase();
  if (value === "S0") return "S0";
  if (value === "S3") return "S3";
  if (value === "S3B") return "S3B";
  return "S5";
}

export function runStrategy(
  strategy: SearchStrategy,
  query: Int16Array,
  ds: LoadedDataset,
  grid: GridIndex | null,
): number {
  switch (strategy) {
    case "S0":
      return knn5S0(query, ds);
    case "S3":
      if (!grid) throw new Error("S3 requires grid index");
      return knn5S3(query, ds, grid);
    case "S3B":
      if (!grid) throw new Error("S3B requires grid index");
      return knn5S3b(query, ds, grid);
    case "S5":
    default:
      if (!grid) throw new Error("S5 requires grid index");
      return knn5Prod(query, ds, grid);
  }
}
