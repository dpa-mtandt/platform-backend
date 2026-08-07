export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

/** Parse ?page/?limit into safe, clamped pagination params. */
export function parsePagination(
  q: { page?: unknown; limit?: unknown },
  defaultLimit = 20,
  maxLimit = 100,
): PaginationParams {
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(Number(q.limit) || defaultLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

export function buildPaginationMeta(total: number, page: number, limit: number) {
  return { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
