type RequestMeta = {
  requestId: string;
  startAt: number;
};

const metaMap = new WeakMap<Request, RequestMeta>();

export function initRequestMeta(request: Request, requestId: string) {
  metaMap.set(request, { requestId, startAt: performance.now() });
}

export function getRequestMeta(request: Request): RequestMeta | null {
  return metaMap.get(request) ?? null;
}
