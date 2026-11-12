/** API envelope shapes (blueprint §4.2 / CLAUDE.md "API shape"). */

/** Where a payload came from. Synthetic and live data are never mixed in one view. */
export type Dataset = 'synthetic' | 'live';

export interface ResponseMeta {
  dataset: Dataset;
  /** ISO-8601 UTC time the payload was produced. */
  generatedAt: string;
  requestId?: string;
  nextToken?: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ResponseMeta;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}
