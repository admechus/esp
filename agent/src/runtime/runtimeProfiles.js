import { resolve } from "node:path";
import { getTransportById } from "../transport/transportDiagnostics.js";
import { readJsonFile } from "../storage/jsonFiles.js";

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

export function validateRuntimeProfile(profile, registry) {
  const errors = [];
  const normalizedProfile = profile && typeof profile === "object" ? { ...profile } : null;

  if (!normalizedProfile) {
    return {
      ok: false,
      profile: null,
      transport: null,
      errors: ["Runtime profile must be an object."]
    };
  }

  if (!hasValue(normalizedProfile.profileName) || typeof normalizedProfile.profileName !== "string") {
    errors.push("Runtime profile is missing profileName.");
  }

  if (!hasValue(normalizedProfile.transport) || typeof normalizedProfile.transport !== "string") {
    errors.push("Runtime profile is missing transport.");
  }

  const transport =
    normalizedProfile.transport && registry?.get
      ? getTransportById(registry, normalizedProfile.transport)
      : null;

  if (normalizedProfile.transport && !transport) {
    errors.push(`Transport ${normalizedProfile.transport} is not active in this runtime registry.`);
  }

  const requirements = transport?.metadata?.configRequirements ?? [];
  for (const requirement of requirements) {
    if (requirement.required && !hasValue(normalizedProfile[requirement.name])) {
      errors.push(
        `Runtime profile ${normalizedProfile.profileName ?? "<unnamed>"} is missing required field ${requirement.name} for transport ${transport.id}.`
      );
    }
  }

  return {
    ok: errors.length === 0,
    profile: normalizedProfile,
    transport,
    errors
  };
}

export async function loadRuntimeProfile(filePath, registry) {
  const resolvedPath = resolve(filePath);
  const profile = await readJsonFile(resolvedPath);
  const validation = validateRuntimeProfile(profile, registry);

  return {
    filePath: resolvedPath,
    ...validation
  };
}

export function applyRuntimeProfile(options = {}, loadedProfile = null) {
  if (!loadedProfile?.ok || !loadedProfile.profile) {
    return { ...options };
  }

  return {
    ...options,
    profileName: options.profileName ?? loadedProfile.profile.profileName ?? null,
    transportId: options.transportId ?? loadedProfile.profile.transport ?? null,
    remoteUrl: options.remoteUrl ?? loadedProfile.profile.remoteUrl ?? null,
    targetAgent: options.targetAgent ?? loadedProfile.profile.targetAgent ?? null,
    filePath: options.filePath ?? loadedProfile.profile.filePath ?? null
  };
}
