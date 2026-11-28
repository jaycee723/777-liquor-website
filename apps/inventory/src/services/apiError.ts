export interface ApiErrorOptions {
  status: number;
  code?: string;
  details?: unknown;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code ?? ApiError.defaultCodeForStatus(options.status);
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }

  static defaultCodeForStatus(status: number): string {
    if (status === 0) return 'NETWORK_ERROR';
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 408) return 'TIMEOUT';
    if (status === 409) return 'CONFLICT';
    if (status === 422) return 'VALIDATION_ERROR';
    if (status >= 500) return 'SERVER_ERROR';
    return 'HTTP_ERROR';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isStalePreviewToken(): boolean {
    return (
      this.status === 409 &&
      (this.code === 'STALE_PREVIEW_TOKEN' ||
        this.code === 'CONFLICT' ||
        /stale|expired|token/i.test(this.message))
    );
  }
}
