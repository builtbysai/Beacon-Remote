export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 401
        ? "Please sign in."
        : status === 429
          ? "Too many requests. Wait a moment and try again."
          : "Request failed. Please try again.",
    );
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}
