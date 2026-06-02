import { describeYggdrasilRemoteUrl } from "./yggdrasilAddress.js";

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createBaseProbeDescription(options = {}) {
  const remoteUrl = options.remoteUrl ?? null;
  const remoteUrlReadiness = describeYggdrasilRemoteUrl(remoteUrl);

  return {
    diagnosticsOnly: true,
    transportDeliveryEnabled: false,
    messageDeliveryAttempted: false,
    remoteUrl,
    remoteUrlReadiness,
    probeAttempted: false,
    healthEndpoint: null,
    httpStatus: null,
    ok: false,
    payload: null,
    error: null,
    timedOut: false,
    note: "Controlled diagnostics-only GET /health probe. No bundle delivery was attempted."
  };
}

export function describeYggdrasilHealthProbe(options = {}) {
  const result = createBaseProbeDescription(options);
  if (!result.remoteUrl) {
    result.error = "Missing remoteUrl for Yggdrasil health probe.";
    return result;
  }

  if (
    !result.remoteUrlReadiness.validUrl ||
    !result.remoteUrlReadiness.isHttpUrl ||
    !result.remoteUrlReadiness.isBracketedIpv6HttpUrl
  ) {
    result.error = "Yggdrasil health probe requires a bracketed IPv6 HTTP/HTTPS remoteUrl.";
    return result;
  }

  result.healthEndpoint = `${result.remoteUrl}/health`;
  return result;
}

export async function probeYggdrasilHealth(options = {}) {
  const result = describeYggdrasilHealthProbe(options);
  if (!result.remoteUrl) {
    throw new Error("Missing remoteUrl for Yggdrasil health probe.");
  }

  if (result.error) {
    return result;
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 3000;
  result.probeAttempted = true;

  try {
    const response = await fetch(result.healthEndpoint, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const responseText = await response.text();
    result.httpStatus = response.status;
    result.payload = parseJsonSafely(responseText);
    result.ok = response.ok && (result.payload?.ok ?? true) !== false;
    result.error = result.ok ? null : result.payload?.error ?? `Health probe failed: ${response.status}`;
    return result;
  } catch (error) {
    result.timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    result.error = error?.message ?? "Yggdrasil health probe failed.";
    return result;
  }
}
