export async function parseTransportJson(response) {
  return response.json().catch(() => null);
}

export function assertTransportOk(response, payload, fallbackMessage) {
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? fallbackMessage(response.status));
  }
}
