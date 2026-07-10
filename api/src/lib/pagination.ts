import { z } from "zod";

/**
 * Cursor pagination, not offset. Auctions are inserted constantly; `?page=2`
 * would silently skip or duplicate rows every time a new auction lands between
 * two requests. The cursor is an opaque object id — treat it as a token.
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function listResponse<T>(items: T[], limit: number, cursorOf: (item: T) => string) {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  return {
    object: "list",
    data,
    has_more: hasMore,
    next_cursor: hasMore && data.length ? cursorOf(data[data.length - 1]!) : null,
  };
}
