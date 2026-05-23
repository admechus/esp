export const PLATFORM_PROFILES = [
  {
    id: "identity-token",
    label: "Identity Token",
    examples: ["LilyGO T-Dongle-S3"],
    connectivity: ["USB", "Wi-Fi", "BLE"],
    storage: ["flash", "encrypted-nvs", "sd-optional"],
    trustLevel: "root-identity-holder",
    roles: ["identity", "approval", "signing"],
    gpio: {
      chipFamilies: ["esp32s3"],
      pinCount: 49,
      inputRange: "0-48",
      outputRange: "0-48",
      liveProbeSupported: false,
      probeStatus: "device-info-only",
      reservedNotes: [
        "Boot, flash, and PSRAM-related pins should be treated as reserved.",
        "USB Serial/JTAG transport is active on this profile."
      ]
    }
  },
  {
    id: "host-attached-node",
    label: "Host-Attached Node",
    examples: ["ESP32-WROOM", "ESP32U"],
    connectivity: ["USB-UART", "Wi-Fi", "BLE"],
    storage: ["flash"],
    trustLevel: "delegated-node",
    roles: ["gateway", "peer", "worker"],
    gpio: {
      chipFamilies: ["esp32"],
      pinCount: 40,
      inputRange: "0-39",
      outputRange: "0-33",
      liveProbeSupported: false,
      probeStatus: "device-info-only",
      reservedNotes: [
        "Boot strap and flash-related pins should be treated as reserved.",
        "UART console transport is active on this profile."
      ]
    }
  },
  {
    id: "storage-limited-node",
    label: "Storage-Limited Node",
    examples: ["constrained ESP peer"],
    connectivity: ["Wi-Fi", "BLE", "UART"],
    storage: ["flash-small-or-none"],
    trustLevel: "ephemeral-peer",
    roles: ["relay", "worker", "observer"],
    gpio: {
      chipFamilies: ["esp32", "esp32s3"],
      pinCount: null,
      inputRange: "chip-dependent",
      outputRange: "chip-dependent",
      liveProbeSupported: false,
      probeStatus: "device-info-only",
      reservedNotes: ["GPIO layout depends on the concrete board and chip."]
    }
  },
  {
    id: "storage-extended-node",
    label: "Storage-Extended Node",
    examples: ["ESP with SD expansion"],
    connectivity: ["Wi-Fi", "UART", "BLE"],
    storage: ["flash", "sd"],
    trustLevel: "delegated-node",
    roles: ["relay", "gateway", "buffer"],
    gpio: {
      chipFamilies: ["esp32", "esp32s3"],
      pinCount: null,
      inputRange: "chip-dependent",
      outputRange: "chip-dependent",
      liveProbeSupported: false,
      probeStatus: "device-info-only",
      reservedNotes: ["GPIO layout depends on the concrete board and any attached storage bus."]
    }
  }
];

export function getPlatformProfiles() {
  return PLATFORM_PROFILES;
}

export function getPlatformProfileById(profileId) {
  return PLATFORM_PROFILES.find((profile) => profile.id === profileId) ?? null;
}

export function describePlatformGpio({ profileId, chip, device } = {}) {
  const profile = getPlatformProfileById(profileId);
  const gpio = profile?.gpio ?? null;
  if (!gpio) {
    return {
      profileLabel: profile?.label ?? profileId ?? "Unknown Profile",
      chip: chip ?? "unknown",
      device: device ?? "unknown-device",
      pinCount: null,
      inputRange: "unknown",
      outputRange: "unknown",
      liveProbeSupported: false,
      probeStatus: "unknown",
      reservedNotes: ["No GPIO profile is registered for this platform yet."],
      observedConnections: [],
      connectionStatus: "unknown"
    };
  }

  return {
    profileLabel: profile.label,
    chip: chip ?? gpio.chipFamilies?.[0] ?? "unknown",
    device: device ?? profile.examples?.[0] ?? "unknown-device",
    pinCount: gpio.pinCount,
    inputRange: gpio.inputRange,
    outputRange: gpio.outputRange,
    liveProbeSupported: gpio.liveProbeSupported,
    probeStatus: gpio.probeStatus,
    reservedNotes: gpio.reservedNotes ?? [],
    observedConnections: [],
    connectionStatus: gpio.liveProbeSupported ? "probe-available" : "not-probed"
  };
}
