import { isIP } from "node:net";

function stripIpv6Brackets(value) {
  if (typeof value !== "string") {
    return "";
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1);
  }

  return value;
}

function getIpv6LeadingHextet(address) {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  const firstSegment = normalized.split(":").find((segment) => segment.length > 0) ?? "";
  if (!firstSegment) {
    return null;
  }

  const parsed = Number.parseInt(firstSegment, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function describeRemoteUrlSyntax(remoteUrl) {
  if (typeof remoteUrl !== "string" || !remoteUrl.trim()) {
    return {
      validUrl: false,
      url: null,
      parseError: "Missing remoteUrl."
    };
  }

  try {
    return {
      validUrl: true,
      url: new URL(remoteUrl),
      parseError: null
    };
  } catch (error) {
    return {
      validUrl: false,
      url: null,
      parseError: error.message
    };
  }
}

export function isLikelyYggdrasilIpv6Address(address) {
  const unwrappedAddress = stripIpv6Brackets(address);
  if (isIP(unwrappedAddress) !== 6) {
    return false;
  }

  const leadingHextet = getIpv6LeadingHextet(unwrappedAddress);
  if (leadingHextet === null) {
    return false;
  }

  return leadingHextet >= 0x0200 && leadingHextet < 0x0400;
}

export function isLikelyYggdrasilRemoteUrl(remoteUrl) {
  const description = describeYggdrasilRemoteUrl(remoteUrl);
  return description.validUrl && description.isBracketedIpv6HttpUrl && description.likelyYggdrasilIpv6Address;
}

export function describeYggdrasilRemoteUrl(remoteUrl) {
  const syntax = describeRemoteUrlSyntax(remoteUrl);
  const description = {
    remoteUrl: remoteUrl ?? null,
    validUrl: syntax.validUrl,
    isHttpUrl: false,
    isIpv6: false,
    isBracketedIpv6HttpUrl: false,
    likelyYggdrasilIpv6Address: false,
    likelyYggdrasilRemoteUrl: false,
    hostname: null,
    port: null,
    parseError: syntax.parseError,
    readinessOnly: true,
    connectivityChecked: false,
    note: "Offline syntactic readiness validation only. No Yggdrasil tools or network calls were used."
  };

  if (!syntax.validUrl || !syntax.url) {
    return description;
  }

  const { url } = syntax;
  const hostname = stripIpv6Brackets(url.hostname);
  const rawHost = url.host;
  const isIpv6 = isIP(hostname) === 6;
  const isBracketedIpv6HttpUrl =
    isIpv6 &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    rawHost.startsWith("[") &&
    rawHost.includes("]");
  const likelyYggdrasilIpv6Address = isLikelyYggdrasilIpv6Address(hostname);

  description.isHttpUrl = url.protocol === "http:" || url.protocol === "https:";
  description.isIpv6 = isIpv6;
  description.isBracketedIpv6HttpUrl = isBracketedIpv6HttpUrl;
  description.likelyYggdrasilIpv6Address = likelyYggdrasilIpv6Address;
  description.likelyYggdrasilRemoteUrl =
    description.isHttpUrl && description.isBracketedIpv6HttpUrl && likelyYggdrasilIpv6Address;
  description.hostname = hostname;
  description.port = url.port || null;

  return description;
}
