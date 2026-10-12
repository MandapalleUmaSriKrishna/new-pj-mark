import { z } from 'zod';
import type { Paginated } from '@kdc/shared';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().max(60).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().max(200).optional(),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export interface SortSpec {
  field: string;
  direction: 1 | -1;
}

/** Whitelisted sortable fields keep user input out of the query planner. */
export function resolveSort(
  input: PaginationInput,
  allowed: string[],
  fallback = 'createdAt',
): SortSpec {
  const field = input.sort && allowed.includes(input.sort) ? input.sort : fallback;
  const direction: 1 | -1 = input.order === 'asc' ? 1 : -1;
  return { field, direction };
}

export function paginate<T>(items: T[], total: number, input: PaginationInput): Paginated<T> {
  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    hasMore: input.page * input.pageSize < total,
  };
}

/** Escapes a user-supplied string before embedding it in a `$regex`. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
