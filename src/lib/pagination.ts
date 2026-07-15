export interface PageSlice<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  start: number;
  end: number;
}

export function parsePage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function paginate<T>(items: T[], requestedPage: number, pageSize = 50): PageSlice<T> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer');
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const offset = (page - 1) * pageSize;
  const pageItems = items.slice(offset, offset + pageSize);

  return {
    items: pageItems,
    page,
    pageSize,
    total,
    totalPages,
    start: total === 0 ? 0 : offset + 1,
    end: total === 0 ? 0 : offset + pageItems.length,
  };
}

export function paginationItems(page: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b);
  const items: (number | 'ellipsis')[] = [];

  for (let index = 0; index < pages.length; index++) {
    const value = pages[index];
    const previous = pages[index - 1];
    if (index > 0 && value - previous === 2) items.push(previous + 1);
    else if (index > 0 && value - previous > 2) items.push('ellipsis');
    items.push(value);
  }

  return items;
}
