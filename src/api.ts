export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined || method !== "GET") {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: Object.keys(headers).length ? headers : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data as T;
}
export type * from "./types";
export { statusLabels } from "./types";
export { date, initials } from "./ui";
