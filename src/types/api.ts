export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiSuccessPayload<T> {
  success: true;
  data: T;
  error: null;
  meta: {
    timestamp: string;
    requestId: string;
    [key: string]: any;
  };
}

export interface ApiErrorPayload {
  success: false;
  data: null;
  error: ApiErrorBody;
  meta: {
    timestamp: string;
    requestId: string;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedApiPayload<T> {
  success: true;
  data: T[];
  error: null;
  meta: PaginationMeta & {
    timestamp: string;
    requestId: string;
  };
}
