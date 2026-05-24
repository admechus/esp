export function normalizeRemoteUrl(remoteUrl, missingMessage = "Missing remoteUrl for transport.") {
  if (!remoteUrl) {
    throw new Error(missingMessage);
  }

  const url = new URL(remoteUrl);
  return url.toString().replace(/\/+$/g, "");
}
