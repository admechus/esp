const state = {
  shell: null,
  services: null,
  ports: [],
  discoveryError: null,
  roleMap: [],
  activeConversationId: "all",
  preferredFromRole: "sender",
  activeSection: "chats",
  conversationSearch: "",
  conversationSort: "recent",
  discovery: null,
  discoveryCache: null,
  bindingHints: [],
  roleBindings: [],
  lifecyclePlan: null,
  hardwareActivity: [],
  discoveryAutoRefresh: {
    enabled: false,
    intervalMs: 30000,
    timerId: null,
    lastRunAt: null
  }
};

const elements = {
  shellName: document.getElementById("shell-name"),
  shellMode: document.getElementById("shell-mode"),
  shellUrl: document.getElementById("shell-url"),
  shellPorts: document.getElementById("shell-ports"),
  workspaceTitle: document.getElementById("workspace-title"),
  workspaceSubtitle: document.getElementById("workspace-subtitle"),
  navChatsBadge: document.getElementById("nav-chats-badge"),
  navIdentitiesBadge: document.getElementById("nav-identities-badge"),
  navRelayBadge: document.getElementById("nav-relay-badge"),
  navActivityBadge: document.getElementById("nav-activity-badge"),
  navDiagnosticsBadge: document.getElementById("nav-diagnostics-badge"),
  navItems: Array.from(document.querySelectorAll("[data-section]")),
  panels: Array.from(document.querySelectorAll(".panel")),
  senderStatus: document.getElementById("sender-status"),
  senderTransport: document.getElementById("sender-transport"),
  senderKeyId: document.getElementById("sender-key-id"),
  senderOutboxCount: document.getElementById("sender-outbox-count"),
  senderReceiptsCount: document.getElementById("sender-receipts-count"),
  senderLink: document.getElementById("sender-link"),
  receiverStatus: document.getElementById("receiver-status"),
  receiverTransport: document.getElementById("receiver-transport"),
  receiverKeyId: document.getElementById("receiver-key-id"),
  receiverInboxCount: document.getElementById("receiver-inbox-count"),
  receiverReceiptsCount: document.getElementById("receiver-receipts-count"),
  receiverLink: document.getElementById("receiver-link"),
  relayStatus: document.getElementById("relay-status"),
  relayName: document.getElementById("relay-name"),
  relayTransferCount: document.getElementById("relay-transfer-count"),
  relayQueueCount: document.getElementById("relay-queue-count"),
  relayLink: document.getElementById("relay-link"),
  composerConversationTitle: document.getElementById("composer-conversation-title"),
  composerRouteSummary: document.getElementById("composer-route-summary"),
  composerRoleSender: document.getElementById("composer-role-sender"),
  composerRoleReceiver: document.getElementById("composer-role-receiver"),
  conversationSearch: document.getElementById("conversation-search"),
  conversationSort: document.getElementById("conversation-sort"),
  selectedChatTitle: document.getElementById("selected-chat-title"),
  selectedChatMeta: document.getElementById("selected-chat-meta"),
  selectedChatParticipants: document.getElementById("selected-chat-participants"),
  chatOpenIdentities: document.getElementById("chat-open-identities"),
  chatOpenRelay: document.getElementById("chat-open-relay"),
  chatPullRoute: document.getElementById("chat-pull-route"),
  composerSendForm: document.getElementById("composer-send-form"),
  composerSendText: document.getElementById("composer-send-text"),
  composerSendButton: document.getElementById("composer-send-button"),
  composerSendResult: document.getElementById("composer-send-result"),
  pullSender: document.getElementById("pull-sender"),
  pullReceiver: document.getElementById("pull-receiver"),
  relayQueueResult: document.getElementById("relay-queue-result"),
  relayQueueList: document.getElementById("relay-queue-list"),
  conversationFilters: document.getElementById("conversation-filters"),
  activeConversationTitle: document.getElementById("active-conversation-title"),
  activeConversationMeta: document.getElementById("active-conversation-meta"),
  conversationList: document.getElementById("conversation-list"),
  outboxList: document.getElementById("outbox-list"),
  inboxList: document.getElementById("inbox-list"),
  receiptsList: document.getElementById("receipts-list"),
  hardwareActivityList: document.getElementById("hardware-activity-list"),
  refreshAll: document.getElementById("refresh-all"),
  diagShellName: document.getElementById("diag-shell-name"),
  diagShellMode: document.getElementById("diag-shell-mode"),
  diagShellUrl: document.getElementById("diag-shell-url"),
  diagShellPorts: document.getElementById("diag-shell-ports"),
  roleMapList: document.getElementById("role-map-list"),
  diagPullAll: document.getElementById("diag-pull-all"),
  diagRefreshDiscovery: document.getElementById("diag-refresh-discovery"),
  diagToggleDiscoveryAuto: document.getElementById("diag-toggle-discovery-auto"),
  diagApplyBindings: document.getElementById("diag-apply-bindings"),
  diagAdoptLiveBindings: document.getElementById("diag-adopt-live-bindings"),
  diagReconcileLiveState: document.getElementById("diag-reconcile-live-state"),
  diagClearConflictingBindings: document.getElementById("diag-clear-conflicting-bindings"),
  diagClearAppliedPlan: document.getElementById("diag-clear-applied-plan"),
  diagOpenChats: document.getElementById("diag-open-chats"),
  diagOpenRelay: document.getElementById("diag-open-relay"),
  diagLifecycleResult: document.getElementById("diag-lifecycle-result"),
  lifecyclePlanList: document.getElementById("lifecycle-plan-list"),
  discoverySummary: document.getElementById("discovery-summary"),
  discoveryCandidates: document.getElementById("discovery-candidates"),
  bindingHintsList: document.getElementById("binding-hints-list"),
  discoveryHistoryList: document.getElementById("discovery-history-list"),
  diagSenderLink: document.getElementById("diag-sender-link"),
  diagReceiverLink: document.getElementById("diag-receiver-link"),
  diagRelayLink: document.getElementById("diag-relay-link")
};

const sectionMeta = {
  chats: {
    title: "Chats",
    subtitle: "Unified conversation view across sender and receiver roles."
  },
  identities: {
    title: "Identities",
    subtitle: "Hardware-backed sender and receiver roles with live transport status."
  },
  relay: {
    title: "Relay",
    subtitle: "Queue recovery, deferred delivery, and gateway inspection."
  },
  activity: {
    title: "Activity",
    subtitle: "Recent outbox, inbox, and receipt history for the active conversation."
  },
  diagnostics: {
    title: "Diagnostics",
    subtitle: "Shell metadata, links, and port-level lab visibility."
  }
};

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function setPanel(panel, html, isError = false) {
  panel.classList.remove("hidden", "error");
  panel.innerHTML = html;
  if (isError) {
    panel.classList.add("error");
  }
}

function clearPanel(panel) {
  panel.classList.add("hidden");
  panel.classList.remove("error");
  panel.innerHTML = "";
}

function renderLifecycleActionDetails(items, mapper, emptyText = "none") {
  if (!Array.isArray(items) || !items.length) {
    return `<div class="result-meta">${escapeHtml(emptyText)}</div>`;
  }

  return items
    .map((item) => `<div class="result-meta">${escapeHtml(mapper(item))}</div>`)
    .join("");
}

function getLiveCandidateIdForRole(roleId) {
  const candidate = (state.discovery?.candidates ?? []).find(
    (entry) => entry.kind === "live-role-port" && entry.roleId === roleId
  );
  return candidate?.id ?? null;
}

function getServiceState(role) {
  return state.services?.[role]?.state ?? null;
}

function getServiceHealth(role) {
  return state.services?.[role]?.health ?? null;
}

function getServiceOk(role) {
  return Boolean(state.services?.[role]?.ok);
}

function getRoleIdentity(role) {
  return getServiceState(role)?.identity?.keyId ?? null;
}

function sortByNewest(items, dateSelector) {
  return [...items].sort((left, right) => dateSelector(right).localeCompare(dateSelector(left)));
}

function renderMessageCollection(targetElement, items, emptyText, mapper) {
  if (!items.length) {
    targetElement.className = "message-list empty-state";
    targetElement.textContent = emptyText;
    return;
  }

  targetElement.className = "message-list";
  targetElement.innerHTML = items.map(mapper).join("");
}

function buildConversationIdFromParticipants(participants) {
  const uniqueParticipants = [...new Set(participants.filter(Boolean))].sort();
  return uniqueParticipants.length ? uniqueParticipants.join("|") : "unknown";
}

function parseConversationParticipants(conversationId) {
  if (!conversationId || conversationId === "all" || conversationId === "unknown") {
    return [];
  }

  return conversationId.split("|").filter(Boolean);
}

function createConversationItem({
  role,
  record,
  direction,
  ownKeyId,
  status,
  unread = false,
  action = null
}) {
  const senderKeyId =
    record.senderKeyId ??
    (direction === "outbound" || direction === "self" ? ownKeyId : null);
  const recipientKeyId =
    record.recipientKeyId ??
    (direction === "inbound" || direction === "self" ? ownKeyId : null);
  const participants = [...new Set([senderKeyId, recipientKeyId].filter(Boolean))];

  return {
    role,
    direction,
    messageId: record.messageId,
    textPreview: record.textPreview,
    createdAt: record.envelopeCreatedAt ?? record.createdAt ?? "",
    status,
    unread,
    action,
    conversationId: buildConversationIdFromParticipants(participants),
    participants,
    senderKeyId,
    recipientKeyId
  };
}

function buildConversationItems() {
  const senderOwnKey = getRoleIdentity("sender");
  const receiverOwnKey = getRoleIdentity("receiver");

  const senderOutbox = (getServiceState("sender")?.outbox ?? []).map((message) =>
    createConversationItem({
      role: "sender",
      record: message,
      direction: "outbound",
      ownKeyId: senderOwnKey,
      status: message.status,
      unread: false,
      action: null
    })
  );

  const receiverInbox = (getServiceState("receiver")?.messages ?? []).map((message) =>
    createConversationItem({
      role: "receiver",
      record: message,
      direction: message.direction ?? "inbound",
      ownKeyId: receiverOwnKey,
      status: message.readAt ? "read_local" : "unread_local",
      unread: message.direction === "inbound" && !message.readAt,
      action: message.direction === "inbound" && !message.readAt ? "mark-read" : null
    })
  );

  const receiverOutbox = (getServiceState("receiver")?.outbox ?? []).map((message) =>
    createConversationItem({
      role: "receiver",
      record: message,
      direction: "outbound",
      ownKeyId: receiverOwnKey,
      status: message.status,
      unread: false,
      action: null
    })
  );

  const senderInbox = (getServiceState("sender")?.messages ?? []).map((message) =>
    createConversationItem({
      role: "sender",
      record: message,
      direction: message.direction ?? "inbound",
      ownKeyId: senderOwnKey,
      status: message.readAt ? "read_local" : "unread_local",
      unread: message.direction === "inbound" && !message.readAt,
      action: message.direction === "inbound" && !message.readAt ? "mark-read" : null
    })
  );

  return sortByNewest(
    [...senderOutbox, ...receiverInbox, ...receiverOutbox, ...senderInbox],
    (item) => item.createdAt ?? ""
  );
}

function getPeerDirectory() {
  const directory = new Map();

  for (const role of ["sender", "receiver"]) {
    const roleState = getServiceState(role);
    const ownIdentity = roleState?.identity?.keyId ?? null;
    if (ownIdentity) {
      directory.set(ownIdentity, {
        label: `${role} identity`,
        role,
        own: true
      });
    }

    for (const peer of roleState?.peers ?? []) {
      if (!peer?.keyId || directory.has(peer.keyId)) {
        continue;
      }

      directory.set(peer.keyId, {
        label: peer.label ?? peer.keyId,
        role: peer.role ?? "peer",
        own: false
      });
    }
  }

  return directory;
}

function getParticipantLabel(participantId, peerDirectory) {
  if (!participantId) {
    return "unknown";
  }

  const peer = peerDirectory.get(participantId);
  if (peer?.label) {
    return peer.label;
  }

  return participantId.startsWith("p256:") ? `peer ${participantId.slice(0, 13)}` : participantId;
}

function getConversationLabel(conversationId, peerDirectory) {
  if (conversationId === "all") {
    return "All conversations";
  }

  const participants = parseConversationParticipants(conversationId);
  if (!participants.length) {
    return "Unknown conversation";
  }

  if (participants.length === 1) {
    return getParticipantLabel(participants[0], peerDirectory);
  }

  return participants.map((participantId) => getParticipantLabel(participantId, peerDirectory)).join(" <-> ");
}

function getConversationCatalog() {
  const peerDirectory = getPeerDirectory();
  const items = buildConversationItems();
  const grouped = new Map();

  for (const item of items) {
    const conversationId = item.conversationId ?? "unknown";
    const existing = grouped.get(conversationId) ?? {
      id: conversationId,
      label: getConversationLabel(conversationId, peerDirectory),
      totalCount: 0,
      unreadCount: 0,
      latestAt: "",
      latestText: "",
      latestStatus: "",
      latestRole: "",
      latestDirection: "",
      participants: item.participants
    };

    existing.totalCount += 1;
    if (item.unread) {
      existing.unreadCount += 1;
    }
    if ((item.createdAt ?? "") >= existing.latestAt) {
      existing.latestAt = item.createdAt ?? "";
      existing.latestText = item.textPreview ?? "";
      existing.latestStatus = item.status ?? "";
      existing.latestRole = item.role ?? "";
      existing.latestDirection = item.direction ?? "";
    }

    grouped.set(conversationId, existing);
  }

  return [
    {
      id: "all",
      label: "All conversations",
      totalCount: items.length,
      unreadCount: items.filter((item) => item.unread).length,
      latestAt: items[0]?.createdAt ?? "",
      latestText: items[0]?.textPreview ?? "",
      latestStatus: items[0]?.status ?? "",
      latestRole: items[0]?.role ?? "",
      latestDirection: items[0]?.direction ?? "",
      participants: []
    },
    ...sortByNewest(Array.from(grouped.values()), (item) => item.latestAt ?? "")
  ];
}

function getFilteredConversationCatalog() {
  const query = state.conversationSearch.trim().toLowerCase();
  let catalog = getConversationCatalog();

  if (query) {
    catalog = catalog.filter((item) => {
      const haystack = [
        item.label,
        item.latestText,
        ...(item.participants ?? [])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  if (state.conversationSort === "name") {
    return [...catalog].sort((left, right) => left.label.localeCompare(right.label));
  }

  if (state.conversationSort === "unread") {
    return [...catalog].sort((left, right) => {
      if (right.unreadCount !== left.unreadCount) {
        return right.unreadCount - left.unreadCount;
      }
      return (right.latestAt ?? "").localeCompare(left.latestAt ?? "");
    });
  }

  return [...catalog].sort((left, right) => (right.latestAt ?? "").localeCompare(left.latestAt ?? ""));
}

function getSelectedConversationSummary() {
  const catalog = getConversationCatalog();
  return catalog.find((item) => item.id === state.activeConversationId) ?? catalog[0];
}

function getFilteredConversationItems() {
  const items = buildConversationItems().slice(0, 40);
  if (state.activeConversationId === "all") {
    return items;
  }

  return items.filter((item) => item.conversationId === state.activeConversationId);
}

function suggestPreferredRole(conversationId) {
  const participants = parseConversationParticipants(conversationId);
  const senderKey = getRoleIdentity("sender");
  const receiverKey = getRoleIdentity("receiver");

  if (participants.length === 1) {
    if (participants[0] === receiverKey) {
      return "sender";
    }
    if (participants[0] === senderKey) {
      return "receiver";
    }
  }

  return state.preferredFromRole;
}

function getComposerTargetRole() {
  return state.preferredFromRole === "sender" ? "receiver" : "sender";
}

function renderTopShell() {
  const shellName = state.shell?.name ?? "-";
  const shellMode = state.shell?.mode ?? "-";
  const shellUrl = state.shell?.links?.unified ?? "-";

  elements.shellName.textContent = shellName;
  elements.shellMode.textContent = shellMode;
  elements.shellUrl.textContent = shellUrl;
  elements.diagShellName.textContent = shellName;
  elements.diagShellMode.textContent = shellMode;
  elements.diagShellUrl.textContent = shellUrl;

  const portsText = state.discoveryError
    ? `Discovery error: ${state.discoveryError}`
    : !state.ports.length
      ? "No ESP ports found"
      : state.ports.map((port) => `${port.port} (${port.kind})`).join(", ");

  elements.shellPorts.textContent = portsText;
  elements.diagShellPorts.textContent = portsText;
}

function renderWorkspaceHeader() {
  const meta = sectionMeta[state.activeSection] ?? sectionMeta.chats;
  elements.workspaceTitle.textContent = meta.title;
  elements.workspaceSubtitle.textContent = meta.subtitle;
}

function renderSidebar() {
  const unreadChats = buildConversationItems().filter((item) => item.unread).length;
  const relayQueuePending = (getServiceState("relay")?.queue ?? []).filter((item) => item.status === "queued").length;
  const activityCount =
    (getServiceState("sender")?.outbox?.length ?? 0) +
    (getServiceState("receiver")?.messages?.length ?? 0) +
    (getServiceState("sender")?.receipts?.length ?? 0) +
    (state.hardwareActivity?.length ?? 0);

  elements.navChatsBadge.textContent = String(unreadChats);
  elements.navIdentitiesBadge.textContent = "2";
  elements.navRelayBadge.textContent = String(relayQueuePending);
  elements.navActivityBadge.textContent = String(activityCount);
  elements.navDiagnosticsBadge.textContent = String(state.ports.length || 0);

  for (const navItem of elements.navItems) {
    navItem.classList.toggle("active", navItem.dataset.section === state.activeSection);
  }

  for (const panel of elements.panels) {
    panel.classList.toggle("active", panel.id === `panel-${state.activeSection}`);
    panel.classList.toggle("hidden", panel.id !== `panel-${state.activeSection}`);
  }
}

function renderSender() {
  const senderState = getServiceState("sender");
  const senderHealth = getServiceHealth("sender");

  elements.senderStatus.textContent = getServiceOk("sender") ? "Connected" : "Unavailable";
  elements.senderTransport.textContent = senderHealth?.transport ?? "-";
  elements.senderKeyId.textContent = senderState?.identity?.keyId ?? "-";
  elements.senderOutboxCount.textContent = String(senderState?.outbox?.length ?? 0);
  elements.senderReceiptsCount.textContent = String(senderState?.receipts?.length ?? 0);
  elements.senderLink.href = state.shell?.links?.sender ?? "#";
  elements.diagSenderLink.href = state.shell?.links?.sender ?? "#";
}

function renderReceiver() {
  const receiverState = getServiceState("receiver");
  const receiverHealth = getServiceHealth("receiver");

  elements.receiverStatus.textContent = getServiceOk("receiver") ? "Connected" : "Unavailable";
  elements.receiverTransport.textContent = receiverHealth?.transport ?? "-";
  elements.receiverKeyId.textContent = receiverState?.identity?.keyId ?? "-";
  elements.receiverInboxCount.textContent = String(receiverState?.messages?.length ?? 0);
  elements.receiverReceiptsCount.textContent = String(receiverState?.receipts?.length ?? 0);
  elements.receiverLink.href = state.shell?.links?.receiver ?? "#";
  elements.diagReceiverLink.href = state.shell?.links?.receiver ?? "#";
}

function renderRelay() {
  const relayState = getServiceState("relay");
  const queue = relayState?.queue ?? [];
  const pendingCount = queue.filter((item) => item.status === "queued").length;

  elements.relayStatus.textContent = getServiceOk("relay") ? "Connected" : "Unavailable";
  elements.relayName.textContent = relayState?.relay?.name ?? "-";
  elements.relayTransferCount.textContent = String(relayState?.transfers?.length ?? 0);
  elements.relayQueueCount.textContent = String(pendingCount);
  elements.relayLink.href = state.shell?.links?.relay ?? "#";
  elements.diagRelayLink.href = state.shell?.links?.relay ?? "#";
}

function renderRoleMap() {
  const roleMap = state.roleMap ?? [];

  function formatHardwareOutputs(outputs) {
    if (!Array.isArray(outputs) || !outputs.length) {
      return "no outputs reported";
    }

    return outputs
      .map((output) => {
        const parts = [output.kind];
        if (output.driver) {
          parts.push(output.driver);
        } else if (output.driverFamily) {
          parts.push(output.driverFamily);
        }
        if (output.resolution) {
          parts.push(output.resolution);
        }
        if (output.i2cAddress) {
          parts.push(output.i2cAddress);
        }
        if (Number.isFinite(output.sda) && Number.isFinite(output.scl)) {
          parts.push(`SDA ${output.sda} / SCL ${output.scl}`);
        }
        if (Number.isFinite(output.mosi) && Number.isFinite(output.sclk) && Number.isFinite(output.cs)) {
          parts.push(`MOSI ${output.mosi} / SCLK ${output.sclk} / CS ${output.cs}`);
        }
        if (Number.isFinite(output.dc)) {
          parts.push(`DC ${output.dc}`);
        }
        if (Number.isFinite(output.rst)) {
          parts.push(`RST ${output.rst}`);
        }
        if (Number.isFinite(output.backlight)) {
          parts.push(`BL ${output.backlight}`);
        }
        if (Number.isFinite(output.preset)) {
          parts.push(`preset ${output.preset}`);
        }
        if (output.status) {
          parts.push(output.status);
        }
        if (output.confidence) {
          parts.push(output.confidence);
        }
        if (output.learned) {
          parts.push("learned");
        }
        if (output.note) {
          parts.push(output.note);
        }
        return parts.join(", ");
      })
      .join(" | ");
  }

  function buildOutputTestButtons(entry) {
    if (!entry.ok || !Array.isArray(entry.hardware?.outputs) || !entry.hardware.outputs.length) {
      return "";
    }

    const buttonTargets = new Set(entry.hardware.outputs.map((output) => output.kind).filter(Boolean));
    const buttons = Array.from(buttonTargets).map(
      (target) => `
        <button
          class="button button-secondary button-small"
          type="button"
          data-action="test-output"
          data-role="${escapeHtml(entry.role)}"
          data-target="${escapeHtml(target)}"
        >
          Test ${escapeHtml(target)}
        </button>
      `
    );

    if (buttonTargets.size > 1) {
      buttons.unshift(`
        <button
          class="button button-secondary button-small"
          type="button"
          data-action="test-output"
          data-role="${escapeHtml(entry.role)}"
          data-target="all"
        >
          Test All Outputs
        </button>
      `);
    }

    return buttons.length ? `<div class="message-actions">${buttons.join("")}</div>` : "";
  }

  renderMessageCollection(
    elements.roleMapList,
    roleMap,
    "No role map available.",
    (entry) => `
      <article class="message-item">
        <div class="message-item-topline">
          <span class="message-title">${escapeHtml(entry.role)}</span>
          <span class="status-pill">${escapeHtml(entry.ok ? "online" : "offline")}</span>
        </div>
        <div class="message-meta">Kind: ${escapeHtml(entry.kind ?? "-")}</div>
        <div class="message-meta">Mode: ${escapeHtml(entry.mode ?? "-")}</div>
        <div class="message-meta">Transport: ${escapeHtml(entry.transport ?? "-")}</div>
        ${
          entry.hardware?.device || entry.hardware?.chip || entry.hardware?.profileLabel
            ? `<div class="message-meta">Platform: ${escapeHtml(
                [entry.hardware?.device, entry.hardware?.chip, entry.hardware?.profileLabel].filter(Boolean).join(" / ")
              )}</div>`
            : ""
        }
        ${
          entry.hardware?.gpioPlatform
            ? `<div class="message-meta">GPIO: ${escapeHtml(
                entry.hardware.gpioPlatform.pinCount
                  ? `${entry.hardware.gpioPlatform.pinCount} pins, in ${entry.hardware.gpioPlatform.inputRange}, out ${entry.hardware.gpioPlatform.outputRange}`
                  : `profile-based, in ${entry.hardware.gpioPlatform.inputRange}, out ${entry.hardware.gpioPlatform.outputRange}`
              )}</div>`
            : ""
        }
        ${
          entry.hardware?.gpioPlatform
            ? `<div class="message-meta">GPIO probe: ${escapeHtml(
                entry.hardware.gpioPlatform.liveProbeSupported
                  ? "live"
                  : `${entry.hardware.gpioPlatform.probeStatus ?? "not-probed"}`
              )}</div>`
            : ""
        }
        ${
          entry.hardware?.outputs?.length
            ? `<div class="message-meta">Outputs: ${escapeHtml(formatHardwareOutputs(entry.hardware.outputs))}</div>`
            : ""
        }
        ${
          entry.hardware?.hardwareProfile?.learnedConfig?.hasLearnedDisplayPreset
            ? `<div class="message-meta">Learned display preset: ${escapeHtml(
                String(entry.hardware.hardwareProfile.learnedConfig.displayPreset ?? "?")
              )} (${escapeHtml(entry.hardware.hardwareProfile.learnedConfig.displayConfidence ?? "learned")})</div>`
            : ""
        }
        ${
          entry.hardware?.gpioPlatform && !entry.hardware.gpioPlatform.observedConnections?.length
            ? `<div class="message-meta">GPIO attachments: ${escapeHtml(
                entry.hardware.gpioPlatform.attachmentStatus ??
                  (entry.hardware.gpioPlatform.liveProbeSupported
                    ? "no active attachments detected"
                    : "live attachment probe is not supported by current firmware")
              )}</div>`
            : ""
        }
        ${
          entry.hardware?.gpioPlatform?.reservedNotes?.length
            ? `<div class="message-meta">GPIO notes: ${escapeHtml(entry.hardware.gpioPlatform.reservedNotes.join(" | "))}</div>`
            : ""
        }
        ${
          entry.hardware?.capabilities?.length
            ? `<div class="message-meta">Capabilities: ${escapeHtml(entry.hardware.capabilities.join(", "))}</div>`
            : ""
        }
        ${
          entry.hardware?.deviceInfoError
            ? `<div class="message-meta">Device info: ${escapeHtml(
                entry.hardware.deviceInfoCached
                  ? `cached fallback (${entry.hardware.deviceInfoError})`
                  : `unavailable (${entry.hardware.deviceInfoError})`
              )}</div>`
            : ""
        }
        ${
          entry.hardware?.platformIoError
            ? `<div class="message-meta">Platform I/O: ${escapeHtml(
                entry.hardware.platformIoCached
                  ? `cached fallback (${entry.hardware.platformIoError})`
                  : `unavailable (${entry.hardware.platformIoError})`
              )}</div>`
            : ""
        }
        <div class="message-meta mono">${escapeHtml(entry.identityKeyId ?? entry.baseUrl ?? "-")}</div>
        ${
          entry.remoteUrl
            ? `<div class="message-meta">Route: ${escapeHtml(entry.targetAgent ?? "-")} via ${escapeHtml(entry.remoteUrl)}</div>`
            : ""
        }
        ${
          Array.isArray(entry.routes) && entry.routes.length
            ? `<div class="message-meta">Routes: ${escapeHtml(entry.routes.map((route) => `${route.name} -> ${route.targetUrl}`).join(", "))}</div>`
            : ""
        }
        ${buildOutputTestButtons(entry)}
      </article>
    `
  );
}

function renderDiscovery() {
  const discovery = state.discovery;
  const candidates = discovery?.candidates ?? [];
  const summary = discovery?.summary ?? null;
  const bindingHints = state.bindingHints ?? [];
  const discoveryHistory = state.discoveryCache?.history ?? [];
  const bindingMap = new Map((state.roleBindings ?? []).map((binding) => [binding.candidateId, binding]));

  renderMessageCollection(
    elements.discoverySummary,
    summary
      ? [
          {
            title: "Current snapshot",
            lines: [
              `Generated: ${discovery.generatedAt ?? "-"}`,
              `Local ports: ${summary.localPorts ?? 0}`,
              `Live roles: ${summary.liveRoles ?? 0}`,
              `Network agents: ${summary.networkAgents ?? 0}`,
              `Candidates: ${summary.candidateCount ?? 0}`,
              `Links: ${summary.linkCount ?? 0}`,
              `Cached snapshot: ${state.discoveryCache?.latestGeneratedAt ?? "none"}`
            ]
          }
        ]
      : [],
    "No discovery snapshot available.",
    (item) => `
      <article class="message-item">
        <div class="message-item-topline">
          <span class="message-title">${escapeHtml(item.title)}</span>
        </div>
        ${item.lines.map((line) => `<div class="message-meta">${escapeHtml(line)}</div>`).join("")}
      </article>
    `
  );

  renderMessageCollection(
    elements.discoveryCandidates,
    candidates,
    "No discovery candidates right now.",
    (candidate) => {
      const binding = candidate.binding ?? bindingMap.get(candidate.id) ?? null;
      const actions = [];

      if (candidate.kind === "unassigned-port") {
        actions.push(`
          <button class="button button-secondary button-small" type="button" data-action="bind-candidate" data-candidate-id="${escapeHtml(candidate.id)}" data-assigned-role="identity-token">
            Bind Identity
          </button>
        `);
        actions.push(`
          <button class="button button-secondary button-small" type="button" data-action="bind-candidate" data-candidate-id="${escapeHtml(candidate.id)}" data-assigned-role="receiver">
            Bind Receiver
          </button>
        `);
        actions.push(`
          <button class="button button-secondary button-small" type="button" data-action="bind-candidate" data-candidate-id="${escapeHtml(candidate.id)}" data-assigned-role="gateway">
            Bind Gateway
          </button>
        `);
      } else if (candidate.kind === "live-role-port") {
        actions.push(`
          <button class="button button-secondary button-small" type="button" data-action="bind-candidate" data-candidate-id="${escapeHtml(candidate.id)}" data-assigned-role="${escapeHtml(candidate.roleId === "sender" ? "identity-token" : "receiver")}">
            Adopt Live
          </button>
        `);
      } else if (candidate.kind === "network-agent") {
        actions.push(`
          <button class="button button-secondary button-small" type="button" data-action="bind-candidate" data-candidate-id="${escapeHtml(candidate.id)}" data-assigned-role="gateway">
            Bind Gateway
          </button>
        `);
        actions.push(`
          <button class="button button-secondary button-small" type="button" data-action="bind-candidate" data-candidate-id="${escapeHtml(candidate.id)}" data-assigned-role="remote-peer">
            Bind Remote Peer
          </button>
        `);
      } else {
        actions.push(`
          <button class="button button-secondary button-small" type="button" data-action="bind-candidate" data-candidate-id="${escapeHtml(candidate.id)}" data-assigned-role="remote-peer">
            Bind Remote Peer
          </button>
        `);
      }

      if (binding) {
        actions.push(`
          <button class="button button-secondary button-small" type="button" data-action="unbind-candidate" data-candidate-id="${escapeHtml(candidate.id)}">
            Clear Binding
          </button>
        `);
      }

      return `
      <article class="message-item ${binding ? "message-item-bound" : ""}">
        <div class="message-item-topline">
          <span class="message-title">${escapeHtml(candidate.label ?? candidate.id ?? "candidate")}</span>
          <span class="status-pill">${escapeHtml(candidate.kind ?? "candidate")}</span>
        </div>
        <div class="message-meta">${escapeHtml(candidate.hint ?? "-")}</div>
        ${candidate.port ? `<div class="message-meta mono">${escapeHtml(candidate.port)}</div>` : ""}
        ${candidate.baseUrl ? `<div class="message-meta mono">${escapeHtml(candidate.baseUrl)}</div>` : ""}
        ${candidate.hostName ? `<div class="message-meta">Host: ${escapeHtml(candidate.hostName)}</div>` : ""}
        ${
          candidate.interfaceCount && candidate.interfaceCount > 1
            ? `<div class="message-meta">Interfaces: ${escapeHtml(String(candidate.interfaceCount))}</div>`
            : ""
        }
        ${
          Array.isArray(candidate.sourceAddresses) && candidate.sourceAddresses.length
            ? `<div class="message-meta">Seen on: ${escapeHtml(candidate.sourceAddresses.join(", "))}</div>`
            : ""
        }
        ${candidate.lastSeenAt ? `<div class="message-meta">Last seen: ${escapeHtml(candidate.lastSeenAt)}</div>` : ""}
        ${
          binding
            ? `<div class="message-meta"><strong>Bound role:</strong> ${escapeHtml(binding.assignedRole)}</div>`
            : `<div class="message-meta">Bound role: none</div>`
        }
        ${
          binding?.resolution
            ? `<div class="message-meta"><strong>Binding state:</strong> ${escapeHtml(binding.resolution.state)} - ${escapeHtml(binding.resolution.summary ?? "-")}</div>`
            : ""
        }
        ${
          binding?.resolution?.nextAction
            ? `<div class="message-meta"><strong>Next action:</strong> ${escapeHtml(binding.resolution.nextAction.label)} - ${escapeHtml(binding.resolution.nextAction.detail ?? "-")}</div>`
            : ""
        }
        <div class="message-actions">${actions.join("")}</div>
      </article>
    `;
    }
  );

  renderMessageCollection(
    elements.bindingHintsList,
    bindingHints,
    "No binding hints right now.",
    (hint) => {
      const binding = hint.currentBinding ?? bindingMap.get(hint.candidateId) ?? null;
      const assignAction = binding
        ? ""
        : `
          <button class="button button-secondary button-small" type="button" data-action="bind-candidate" data-candidate-id="${escapeHtml(hint.candidateId)}" data-assigned-role="${escapeHtml(hint.suggestedRole)}">
            Accept Hint
          </button>
        `;

      return `
      <article class="message-item ${binding ? "message-item-bound" : ""}">
        <div class="message-item-topline">
          <span class="message-title">${escapeHtml(hint.suggestedRole ?? "unassigned")}</span>
          <span class="status-pill">${escapeHtml(hint.confidence ?? "info")}</span>
        </div>
        <div class="message-meta mono">${escapeHtml(hint.candidateId ?? "-")}</div>
        <div class="message-meta">${escapeHtml(hint.reason ?? "-")}</div>
        ${
          binding
            ? `<div class="message-meta"><strong>Current binding:</strong> ${escapeHtml(binding.assignedRole)}</div>`
            : ""
        }
        ${
          binding?.resolution
            ? `<div class="message-meta"><strong>Binding state:</strong> ${escapeHtml(binding.resolution.state)} - ${escapeHtml(binding.resolution.summary ?? "-")}</div>`
            : ""
        }
        ${
          binding?.resolution?.nextAction
            ? `<div class="message-meta"><strong>Next action:</strong> ${escapeHtml(binding.resolution.nextAction.label)} - ${escapeHtml(binding.resolution.nextAction.detail ?? "-")}</div>`
            : ""
        }
        <div class="message-actions">
          ${assignAction}
          ${
            binding
              ? `<button class="button button-secondary button-small" type="button" data-action="unbind-candidate" data-candidate-id="${escapeHtml(hint.candidateId)}">Clear Binding</button>`
              : ""
          }
        </div>
      </article>
    `;
    }
  );

  renderMessageCollection(
    elements.discoveryHistoryList,
    discoveryHistory,
    "No cached discovery snapshots yet.",
    (snapshot) => `
      <article class="message-item">
        <div class="message-item-topline">
          <span class="message-title">${escapeHtml(snapshot.generatedAt ?? "snapshot")}</span>
          <span class="status-pill">${escapeHtml(`candidates ${snapshot.summary?.candidateCount ?? 0}`)}</span>
        </div>
        <div class="message-meta">Ports: ${escapeHtml(snapshot.summary?.localPorts ?? 0)}</div>
        <div class="message-meta">Live roles: ${escapeHtml(snapshot.summary?.liveRoles ?? 0)}</div>
        <div class="message-meta">Links: ${escapeHtml(snapshot.summary?.linkCount ?? 0)}</div>
      </article>
    `
  );

  updateDiscoveryAutoButton();
}

function renderLifecyclePlan() {
  const lifecyclePlan = state.lifecyclePlan;

  renderMessageCollection(
    elements.lifecyclePlanList,
    lifecyclePlan
      ? [
          {
            type: "summary",
            appliedAt: lifecyclePlan.appliedAt,
            manageable: lifecyclePlan.manageable,
            bindingCount: lifecyclePlan.summary?.bindingCount ?? 0,
            liveRoleCount: lifecyclePlan.summary?.liveRoleCount ?? 0,
            matchedBindingCount: lifecyclePlan.summary?.matchedBindingCount ?? 0,
            mismatchCount: lifecyclePlan.summary?.mismatchCount ?? 0,
            nextStep: lifecyclePlan.nextStep ?? ""
          },
          ...(lifecyclePlan.plannedRoles ?? []).map((entry) => ({
            type: "binding",
            entry
          }))
        ]
      : [],
    "No applied lifecycle plan yet.",
    (item) => {
      if (item.type === "summary") {
        return `
          <article class="message-item">
            <div class="message-item-topline">
              <span class="message-title">Applied lifecycle plan</span>
              <span class="status-pill">${escapeHtml(item.manageable ? "manageable" : "attached-only")}</span>
            </div>
            <div class="message-meta">Applied: ${escapeHtml(item.appliedAt ?? "-")}</div>
            <div class="message-meta">Bindings: ${escapeHtml(item.bindingCount)}</div>
            <div class="message-meta">Live roles: ${escapeHtml(item.liveRoleCount)}</div>
            <div class="message-meta">Matched: ${escapeHtml(item.matchedBindingCount ?? 0)}</div>
            <div class="message-meta">Mismatched: ${escapeHtml(item.mismatchCount ?? 0)}</div>
            <div class="message-meta">${escapeHtml(item.nextStep)}</div>
          </article>
        `;
      }

      const planned = item.entry;
      return `
        <article class="message-item message-item-bound">
          <div class="message-item-topline">
            <span class="message-title">${escapeHtml(planned.assignedRole ?? "planned-role")}</span>
            <span class="status-pill">${escapeHtml(planned.candidate?.kind ?? "candidate")}</span>
          </div>
          <div class="message-meta">${escapeHtml(planned.candidate?.label ?? planned.candidateId ?? "-")}</div>
          ${planned.candidate?.port ? `<div class="message-meta mono">${escapeHtml(planned.candidate.port)}</div>` : ""}
          <div class="message-meta mono">${escapeHtml(planned.candidateId ?? "-")}</div>
          ${
            planned.resolution
              ? `<div class="message-meta"><strong>Resolution:</strong> ${escapeHtml(planned.resolution.state)} - ${escapeHtml(planned.resolution.summary ?? "-")}</div>`
              : ""
          }
          ${
            planned.resolution?.nextAction
              ? `<div class="message-meta"><strong>Next action:</strong> ${escapeHtml(planned.resolution.nextAction.label)} - ${escapeHtml(planned.resolution.nextAction.detail ?? "-")}</div>`
              : ""
          }
          <div class="message-meta">Updated: ${escapeHtml(planned.updatedAt ?? "-")}</div>
          <div class="message-actions">
            ${
              planned.resolution?.nextAction?.kind === "rebind-live-role" &&
              planned.resolution?.nextAction?.candidateId
                ? `<button class="button button-secondary button-small" type="button" data-action="rebind-live-role" data-candidate-id="${escapeHtml(planned.resolution.nextAction.candidateId)}" data-assigned-role="${escapeHtml(planned.assignedRole ?? "")}">
                    ${escapeHtml(planned.resolution.nextAction.label)}
                  </button>`
                : ""
            }
            ${
              planned.resolution?.nextAction?.kind === "remove-binding"
                ? `<button class="button button-secondary button-small" type="button" data-action="unbind-candidate" data-candidate-id="${escapeHtml(planned.candidateId ?? "")}">
                    ${escapeHtml(planned.resolution.nextAction.label)}
                  </button>`
                : `<button class="button button-secondary button-small" type="button" data-action="unbind-candidate" data-candidate-id="${escapeHtml(planned.candidateId ?? "")}">
                    Remove Planned Binding
                  </button>`
            }
          </div>
        </article>
      `;
    }
  );
}

function renderComposer() {
  const selectedConversation = getSelectedConversationSummary();
  const targetRole = getComposerTargetRole();

  elements.composerConversationTitle.textContent = selectedConversation.label;
  elements.composerRouteSummary.textContent = `${state.preferredFromRole} -> ${targetRole}`;
  elements.composerSendButton.textContent =
    state.preferredFromRole === "sender" ? "Send From Sender" : "Send From Receiver";
  elements.composerRoleSender.classList.toggle("active", state.preferredFromRole === "sender");
  elements.composerRoleReceiver.classList.toggle("active", state.preferredFromRole === "receiver");
}

function renderConversationFilters() {
  const catalog = getFilteredConversationCatalog();
  const current = getSelectedConversationSummary();

  if (!catalog.length) {
    elements.conversationFilters.className = "filter-list empty-state";
    elements.conversationFilters.textContent = state.conversationSearch
      ? "No conversations match the current search."
      : "No conversations yet.";
    elements.activeConversationTitle.textContent = current.label;
    elements.activeConversationMeta.textContent = current.latestText
      ? `${current.totalCount} items, latest: ${current.latestText}`
      : "Unified cross-role timeline";
    return;
  }

  elements.conversationFilters.className = "filter-list";
  elements.conversationFilters.innerHTML = catalog
    .map(
      (item) => `
        <button
          class="filter-chip ${item.id === state.activeConversationId ? "active" : ""}"
          type="button"
          data-conversation-id="${escapeHtml(item.id)}"
        >
          <span class="filter-chip-title">${escapeHtml(item.label)}</span>
          <span class="filter-chip-preview">${escapeHtml(item.latestText || "No messages yet")}</span>
          <span class="filter-chip-meta">
            <strong>${escapeHtml(item.totalCount)}</strong>
            <small>${escapeHtml(item.latestRole || "system")} / ${escapeHtml(item.latestStatus || "idle")}</small>
          </span>
          ${item.unreadCount ? `<em>${escapeHtml(item.unreadCount)} unread</em>` : ""}
        </button>
      `
    )
    .join("");

  elements.activeConversationTitle.textContent = current.label;
  elements.activeConversationMeta.textContent = current.latestText
    ? `${current.totalCount} items, latest: ${current.latestText}`
    : `${current.totalCount} items`;
}

function renderSelectedChatHeader() {
  const selectedConversation = getSelectedConversationSummary();
  const peerDirectory = getPeerDirectory();
  const participants = (selectedConversation.participants ?? []).map((participantId) =>
    getParticipantLabel(participantId, peerDirectory)
  );
  const routeTarget = getComposerTargetRole();

  elements.selectedChatTitle.textContent = selectedConversation.label;
  elements.selectedChatMeta.textContent = selectedConversation.latestText
    ? `${selectedConversation.totalCount} items, latest: ${selectedConversation.latestText}`
    : "Unified cross-role timeline";
  elements.selectedChatParticipants.textContent = participants.length
    ? participants.join(" <-> ")
    : "All roles and conversations";
  elements.chatPullRoute.textContent = `Pull ${routeTarget} Queue`;
}

function renderConversation() {
  const items = getFilteredConversationItems();

  renderMessageCollection(
    elements.conversationList,
    items,
    "No unified timeline items for the selected conversation.",
    (item) => {
      const bubbleClass =
        item.direction === "outbound"
          ? "chat-bubble bubble-outbound"
          : item.direction === "inbound"
            ? "chat-bubble bubble-inbound"
            : "chat-bubble bubble-system";
      const retryTargetRole = item.role === "sender" ? "receiver" : "sender";
      const actionButtons = [];

      if (item.action === "mark-read") {
        actionButtons.push(`
          <button
            class="button button-secondary button-small"
            type="button"
            data-action="mark-read"
            data-role="${escapeHtml(item.role)}"
            data-message-id="${escapeHtml(item.messageId)}"
          >
            Mark Read
          </button>
        `);
      }

      if (item.direction === "outbound" && item.status === "queued_relay") {
        actionButtons.push(`
          <button
            class="button button-secondary button-small"
            type="button"
            data-action="retry-queued"
            data-target-role="${escapeHtml(retryTargetRole)}"
          >
            Retry Queued
          </button>
        `);
      }

      return `
        <article class="${bubbleClass}">
          <div class="message-item-topline">
            <span class="message-title">${escapeHtml(item.role)} / ${escapeHtml(item.direction)}</span>
            <span class="status-pill">${escapeHtml(item.status)}</span>
          </div>
          <div class="chat-text">${escapeHtml(item.textPreview ?? "No text")}</div>
          <div class="message-meta">${escapeHtml(item.createdAt ?? "-")}</div>
          <div class="message-meta mono">${escapeHtml(item.messageId ?? "-")}</div>
          ${
            actionButtons.length
              ? `<div class="message-actions">${actionButtons.join("")}</div>`
              : ""
          }
        </article>
      `;
    }
  );
}

function renderActivity() {
  const selectedConversationId = state.activeConversationId;

  const senderOutbox = sortByNewest(
    getServiceState("sender")?.outbox ?? [],
    (item) => item.envelopeCreatedAt ?? item.createdAt ?? ""
  )
    .filter((item) => {
      if (selectedConversationId === "all") {
        return true;
      }
      return (
        createConversationItem({
          role: "sender",
          record: item,
          direction: "outbound",
          ownKeyId: getRoleIdentity("sender"),
          status: item.status
        }).conversationId === selectedConversationId
      );
    })
    .slice(0, 4);

  const receiverInbox = sortByNewest(
    getServiceState("receiver")?.messages ?? [],
    (item) => item.envelopeCreatedAt ?? item.createdAt ?? ""
  )
    .filter((item) => {
      if (selectedConversationId === "all") {
        return true;
      }
      return (
        createConversationItem({
          role: "receiver",
          record: item,
          direction: item.direction ?? "inbound",
          ownKeyId: getRoleIdentity("receiver"),
          status: item.readAt ? "read_local" : "unread_local"
        }).conversationId === selectedConversationId
      );
    })
    .slice(0, 4);

  const senderReceipts = sortByNewest(
    getServiceState("sender")?.receipts ?? [],
    (item) => item.readAt ?? item.acceptedAt ?? item.createdAt ?? ""
  ).slice(0, 4);
  const hardwareActivity = sortByNewest(
    state.hardwareActivity ?? [],
    (item) => item.createdAt ?? ""
  ).slice(0, 6);

  renderMessageCollection(
    elements.outboxList,
    senderOutbox,
    "No recent sender outbox messages for this conversation.",
    (message) => `
      <article class="message-item">
        <div class="message-item-topline">
          <span class="message-title">${escapeHtml(message.textPreview ?? "No text")}</span>
          <span class="status-pill">${escapeHtml(message.status ?? "unknown")}</span>
        </div>
        <div class="message-meta mono">${escapeHtml(message.messageId ?? "-")}</div>
        <div class="message-meta">${escapeHtml(message.envelopeCreatedAt ?? "-")}</div>
      </article>
    `
  );

  renderMessageCollection(
    elements.inboxList,
    receiverInbox,
    "No recent receiver inbox messages for this conversation.",
    (message) => `
      <article class="message-item">
        <div class="message-item-topline">
          <span class="message-title">${escapeHtml(message.textPreview ?? "No text")}</span>
          <span class="status-pill">${escapeHtml(message.direction ?? "inbound")}</span>
        </div>
        <div class="message-meta mono">${escapeHtml(message.senderKeyId ?? "-")}</div>
        <div class="message-meta">${escapeHtml(message.envelopeCreatedAt ?? "-")}</div>
      </article>
    `
  );

  renderMessageCollection(
    elements.receiptsList,
    senderReceipts,
    "No recent sender receipts.",
    (receipt) => `
      <article class="message-item">
        <div class="message-item-topline">
          <span class="message-title">${escapeHtml(receipt.receiverAgent ?? "receiver")}</span>
          <span class="status-pill">${escapeHtml(receipt.status ?? "unknown")}</span>
        </div>
        <div class="message-meta mono">${escapeHtml(receipt.receiptId ?? "-")}</div>
        <div class="message-meta">${escapeHtml(receipt.readAt ?? receipt.acceptedAt ?? receipt.createdAt ?? "-")}</div>
      </article>
    `
  );

  renderMessageCollection(
    elements.hardwareActivityList,
    hardwareActivity,
    "No recent shell activity.",
    (entry) => `
      <article class="message-item">
        <div class="message-item-topline">
          <span class="message-title">${escapeHtml(entry.action ?? entry.category ?? "activity")}</span>
          <span class="status-pill">${escapeHtml(entry.status ?? "unknown")}</span>
        </div>
        <div class="message-meta">
          ${escapeHtml([entry.category, entry.role, entry.target].filter(Boolean).join(" / ") || "-")}
        </div>
        <div class="message-meta">${escapeHtml(entry.detail ?? "-")}</div>
        <div class="message-meta mono">${escapeHtml(entry.id ?? "-")}</div>
        <div class="message-meta">${escapeHtml(entry.createdAt ?? "-")}</div>
      </article>
    `
  );
}

function renderRelayQueue() {
  const queue = sortByNewest(
    getServiceState("relay")?.queue ?? [],
    (item) => item.queuedAt ?? item.updatedAt ?? ""
  );

  renderMessageCollection(
    elements.relayQueueList,
    queue,
    "Relay queue is empty.",
    (item) => `
      <article class="message-item">
        <div class="message-item-topline">
          <span class="message-title">${escapeHtml(item.targetAgent ?? "unknown-target")}</span>
          <span class="status-pill">${escapeHtml(item.status ?? "unknown")}</span>
        </div>
        <div class="message-meta mono">${escapeHtml(item.queueId ?? "-")}</div>
        <div class="message-meta">Queued: ${escapeHtml(item.queuedAt ?? "-")}</div>
        <div class="message-meta">Messages: ${escapeHtml(item.messageCount ?? 0)}</div>
        <div class="message-meta">Reason: ${escapeHtml(item.queueReason ?? "-")}</div>
        <div class="message-meta">Error: ${escapeHtml(item.lastError ?? "-")}</div>
        <div class="message-actions">
          <button
            class="button button-secondary button-small"
            type="button"
            data-action="pull-target"
            data-target-agent="${escapeHtml(item.targetAgent ?? "")}"
          >
            Pull ${escapeHtml(item.targetAgent ?? "target")}
          </button>
          <button
            class="button button-secondary button-small"
            type="button"
            data-action="queue-delete"
            data-queue-id="${escapeHtml(item.queueId ?? "")}"
          >
            Delete Entry
          </button>
        </div>
      </article>
    `
  );
}

function renderAll() {
  renderTopShell();
  renderWorkspaceHeader();
  renderSidebar();
  renderSender();
  renderReceiver();
  renderRelay();
  renderRoleMap();
  renderDiscovery();
  renderLifecyclePlan();
  renderComposer();
  renderSelectedChatHeader();
  renderConversationFilters();
  renderRelayQueue();
  renderConversation();
  renderActivity();
}

async function loadState() {
  const payload = await fetchJson("/app/state");
  state.shell = payload.shell ?? null;
  state.services = payload.services ?? null;
  state.ports = payload.ports ?? [];
  state.discoveryError = payload.discoveryError ?? null;
  state.roleMap = payload.roleMap ?? [];
  state.discovery = payload.discovery ?? null;
  state.discoveryCache = payload.discoveryCache ?? null;
  state.bindingHints = payload.bindingHints ?? [];
  state.roleBindings = payload.roleBindings ?? [];
  state.lifecyclePlan = payload.lifecyclePlan ?? null;
  state.hardwareActivity = payload.hardwareActivity ?? [];

  const catalogIds = new Set(getConversationCatalog().map((item) => item.id));
  if (!catalogIds.has(state.activeConversationId)) {
    state.activeConversationId = "all";
  }

  renderAll();
}

async function handleSend(event) {
  event.preventDefault();
  clearPanel(elements.composerSendResult);

  try {
    const payload = await fetchJson("/actions/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fromRole: state.preferredFromRole,
        text: elements.composerSendText.value
      })
    });

    setPanel(
      elements.composerSendResult,
      `
        <div class="result-meta"><strong>Send completed.</strong></div>
        <div class="result-meta">From: ${escapeHtml(payload.result.fromRole)}</div>
        <div class="result-meta">Target: ${escapeHtml(payload.result.targetAgent)}</div>
        <div class="result-meta">Message ID: ${escapeHtml(payload.result.envelope?.outboxMessage?.messageId ?? "-")}</div>
        <div class="result-meta">Queue: ${escapeHtml(payload.result.delivery?.queueId ?? "-")}</div>
        <div class="result-meta">Queued: ${payload.result.delivery?.queued ? "yes" : "no"}</div>
      `
    );

    elements.composerSendText.value = "";
    await loadState();
  } catch (error) {
    setPanel(elements.composerSendResult, escapeHtml(error.message), true);
  }
}

async function handlePull(role) {
  clearPanel(elements.relayQueueResult);

  try {
    const payload = await fetchJson("/actions/pull", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        role
      })
    });

    setPanel(
      elements.relayQueueResult,
      `
        <div class="result-meta"><strong>Relay pull completed.</strong></div>
        <div class="result-meta">Role: ${escapeHtml(role)}</div>
        <div class="result-meta">Pulled: ${escapeHtml(payload.result.result?.pulledCount ?? payload.result.pulledCount ?? 0)}</div>
        <div class="result-meta">Delivered: ${escapeHtml(payload.result.result?.deliveredCount ?? payload.result.deliveredCount ?? 0)}</div>
        <div class="result-meta">Failed: ${escapeHtml(payload.result.result?.failedCount ?? payload.result.failedCount ?? 0)}</div>
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.relayQueueResult, escapeHtml(error.message), true);
  }
}

async function handleQueueDelete(queueId) {
  clearPanel(elements.relayQueueResult);

  try {
    const payload = await fetchJson("/actions/queue-delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        queueId
      })
    });

    setPanel(
      elements.relayQueueResult,
      `
        <div class="result-meta"><strong>Queue entry deleted.</strong></div>
        <div class="result-meta">Queue ID: ${escapeHtml(payload.result.result?.queueId ?? queueId)}</div>
        <div class="result-meta">Remaining entries: ${escapeHtml(payload.result.result?.remainingCount ?? 0)}</div>
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.relayQueueResult, escapeHtml(error.message), true);
  }
}

async function handleMarkRead(role, messageId) {
  try {
    await fetchJson("/actions/mark-read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        role,
        messageId
      })
    });

    await loadState();
  } catch (error) {
    setPanel(elements.relayQueueResult, escapeHtml(error.message), true);
  }
}

async function handlePullAll() {
  clearPanel(elements.diagLifecycleResult);

  try {
    const payload = await fetchJson("/actions/pull-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

    const senderPulled = payload.result?.sender?.result?.pulledCount ?? payload.result?.sender?.pulledCount ?? 0;
    const receiverPulled = payload.result?.receiver?.result?.pulledCount ?? payload.result?.receiver?.pulledCount ?? 0;

    setPanel(
      elements.diagLifecycleResult,
      `
        <div class="result-meta"><strong>Pull all routes completed.</strong></div>
        <div class="result-meta">Sender pulled: ${escapeHtml(senderPulled)}</div>
        <div class="result-meta">Receiver pulled: ${escapeHtml(receiverPulled)}</div>
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
  }
}

async function handleTestOutput(role, target) {
  clearPanel(elements.diagLifecycleResult);

  try {
    const payload = await fetchJson("/actions/test-output", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        role,
        target
      })
    });

    const results = Array.isArray(payload.result?.result?.results)
      ? payload.result.result.results
      : Array.isArray(payload.result?.results)
        ? payload.result.results
        : [];

    setPanel(
      elements.diagLifecycleResult,
      `
        <div class="result-meta"><strong>Output test completed.</strong></div>
        <div class="result-meta">Role: ${escapeHtml(role)}</div>
        <div class="result-meta">Target: ${escapeHtml(payload.result?.result?.target ?? payload.result?.target ?? target)}</div>
        ${
          results.length
            ? results
                .map(
                  (result) => `
                    <div class="result-meta">
                      ${escapeHtml(result.kind)}: ${escapeHtml(result.status)}${result.detail ? ` - ${escapeHtml(result.detail)}` : ""}
                    </div>
                  `
                )
                .join("")
            : `<div class="result-meta">No result lines were returned.</div>`
        }
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
  }
}

async function handleRefreshDiscovery() {
  clearPanel(elements.diagLifecycleResult);

  try {
    const payload = await fetchJson("/actions/discovery-refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

    setPanel(
      elements.diagLifecycleResult,
      `
        <div class="result-meta"><strong>Discovery snapshot refreshed.</strong></div>
        <div class="result-meta">Generated: ${escapeHtml(payload.result?.snapshot?.generatedAt ?? "-")}</div>
        <div class="result-meta">Cached snapshots: ${escapeHtml(payload.result?.cache?.snapshotCount ?? 0)}</div>
      `
    );

    await loadState();
    state.discoveryAutoRefresh.lastRunAt = payload.result?.snapshot?.generatedAt ?? new Date().toISOString();
    updateDiscoveryAutoButton();
  } catch (error) {
    setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
  }
}

async function handleApplyBindings() {
  clearPanel(elements.diagLifecycleResult);

  try {
    const payload = await fetchJson("/actions/apply-bindings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

    setPanel(
      elements.diagLifecycleResult,
      `
        <div class="result-meta"><strong>Lifecycle plan applied.</strong></div>
        <div class="result-meta">Bindings: ${escapeHtml(payload.result?.plan?.summary?.bindingCount ?? 0)}</div>
        <div class="result-meta">Mode: ${escapeHtml(payload.result?.plan?.mode ?? "-")}</div>
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
  }
}

async function handleClearAppliedPlan() {
  clearPanel(elements.diagLifecycleResult);

  try {
    const payload = await fetchJson("/actions/clear-applied-plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

    setPanel(
      elements.diagLifecycleResult,
      `
        <div class="result-meta"><strong>Applied lifecycle plan cleared.</strong></div>
        <div class="result-meta">Previous plan: ${escapeHtml(payload.result?.deleted?.appliedAt ?? "none")}</div>
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
  }
}

async function handleAdoptLiveBindings() {
  clearPanel(elements.diagLifecycleResult);

  try {
    const payload = await fetchJson("/actions/adopt-live-bindings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

    setPanel(
      elements.diagLifecycleResult,
      `
        <div class="result-meta"><strong>Live roles adopted.</strong></div>
        <div class="result-meta">Updated bindings: ${escapeHtml(payload.result?.updatedCount ?? 0)}</div>
        <div class="result-meta">Cleared conflicts: ${escapeHtml(payload.result?.clearedCount ?? 0)}</div>
        <div class="result-meta"><strong>Updated:</strong></div>
        ${renderLifecycleActionDetails(
          payload.result?.updated,
          (entry) => `${entry.binding?.assignedRole ?? "role"} <- ${entry.candidate?.port ?? entry.candidate?.id ?? "candidate"}`
        )}
        <div class="result-meta"><strong>Cleared:</strong></div>
        ${renderLifecycleActionDetails(
          payload.result?.cleared,
          (entry) => `${entry.assignedRole ?? "role"} <- ${entry.candidateId ?? "candidate"}`,
          "No conflicting bindings were removed."
        )}
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
  }
}

async function handleReconcileLiveState() {
  clearPanel(elements.diagLifecycleResult);

  try {
    const payload = await fetchJson("/actions/reconcile-live-state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

    setPanel(
      elements.diagLifecycleResult,
      `
        <div class="result-meta"><strong>Live state reconciled.</strong></div>
        <div class="result-meta">Adopted bindings: ${escapeHtml(payload.result?.adopted?.updatedCount ?? 0)}</div>
        <div class="result-meta">Cleared conflicts: ${escapeHtml(payload.result?.adopted?.clearedCount ?? 0)}</div>
        <div class="result-meta">Matched: ${escapeHtml(payload.result?.plan?.summary?.matchedBindingCount ?? 0)}</div>
        <div class="result-meta">Mismatched: ${escapeHtml(payload.result?.plan?.summary?.mismatchCount ?? 0)}</div>
        <div class="result-meta">Plan bindings: ${escapeHtml(payload.result?.plan?.summary?.bindingCount ?? 0)}</div>
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
  }
}

async function handleClearConflictingBindings() {
  clearPanel(elements.diagLifecycleResult);

  try {
    const payload = await fetchJson("/actions/clear-conflicting-bindings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

    setPanel(
      elements.diagLifecycleResult,
      `
        <div class="result-meta"><strong>Conflicting bindings cleared.</strong></div>
        <div class="result-meta">Cleared: ${escapeHtml(payload.result?.clearedCount ?? 0)}</div>
        ${renderLifecycleActionDetails(
          payload.result?.cleared,
          (entry) => `${entry.assignedRole ?? "role"} <- ${entry.candidateId ?? "candidate"}`,
          "No conflicting bindings were found."
        )}
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
  }
}

async function handleBindCandidate(candidateId, assignedRole) {
  clearPanel(elements.diagLifecycleResult);

  try {
    const payload = await fetchJson("/actions/bind-candidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        candidateId,
        assignedRole
      })
    });

    setPanel(
      elements.diagLifecycleResult,
      `
        <div class="result-meta"><strong>Candidate binding saved.</strong></div>
        <div class="result-meta">Candidate: ${escapeHtml(payload.result?.candidate?.label ?? candidateId)}</div>
        <div class="result-meta">Assigned role: ${escapeHtml(payload.result?.binding?.assignedRole ?? assignedRole)}</div>
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
  }
}

async function handleUnbindCandidate(candidateId) {
  clearPanel(elements.diagLifecycleResult);

  try {
    const payload = await fetchJson("/actions/unbind-candidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        candidateId
      })
    });

    setPanel(
      elements.diagLifecycleResult,
      `
        <div class="result-meta"><strong>Candidate binding cleared.</strong></div>
        <div class="result-meta">Candidate: ${escapeHtml(payload.result?.deleted?.candidateId ?? candidateId)}</div>
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
  }
}

function updateDiscoveryAutoButton() {
  if (!elements.diagToggleDiscoveryAuto) {
    return;
  }

  const { enabled, intervalMs, lastRunAt } = state.discoveryAutoRefresh;
  elements.diagToggleDiscoveryAuto.textContent = enabled
    ? `Auto Refresh: On (${Math.round(intervalMs / 1000)}s)`
    : "Auto Refresh: Off";
  elements.diagToggleDiscoveryAuto.classList.toggle("active", enabled);
  elements.diagToggleDiscoveryAuto.title = lastRunAt
    ? `Last discovery refresh: ${lastRunAt}`
    : "Discovery auto refresh is idle.";
}

function stopDiscoveryAutoRefresh() {
  if (state.discoveryAutoRefresh.timerId) {
    clearInterval(state.discoveryAutoRefresh.timerId);
    state.discoveryAutoRefresh.timerId = null;
  }

  state.discoveryAutoRefresh.enabled = false;
  updateDiscoveryAutoButton();
}

function startDiscoveryAutoRefresh() {
  stopDiscoveryAutoRefresh();
  state.discoveryAutoRefresh.enabled = true;
  state.discoveryAutoRefresh.timerId = setInterval(() => {
    handleRefreshDiscovery().catch((error) => {
      setPanel(elements.diagLifecycleResult, escapeHtml(error.message), true);
      stopDiscoveryAutoRefresh();
    });
  }, state.discoveryAutoRefresh.intervalMs);
  updateDiscoveryAutoButton();
}

function handleToggleDiscoveryAuto() {
  if (state.discoveryAutoRefresh.enabled) {
    stopDiscoveryAutoRefresh();
    return;
  }

  startDiscoveryAutoRefresh();
}

function handleConversationClick(event) {
  const filter = event.target.closest("[data-conversation-id]");
  if (filter) {
    state.activeConversationId = filter.dataset.conversationId;
    state.preferredFromRole = suggestPreferredRole(state.activeConversationId);
    renderAll();
    return;
  }

  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }

  if (trigger.dataset.action === "mark-read") {
    handleMarkRead(trigger.dataset.role, trigger.dataset.messageId);
    return;
  }

  if (trigger.dataset.action === "retry-queued") {
    handlePull(trigger.dataset.targetRole);
  }
}

function handleRelayQueueClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }

  if (trigger.dataset.action === "pull-target") {
    handlePull(trigger.dataset.targetAgent);
    return;
  }

  if (trigger.dataset.action === "queue-delete") {
    handleQueueDelete(trigger.dataset.queueId);
  }
}

function handleDiscoveryClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }

  if (trigger.dataset.action === "bind-candidate") {
    handleBindCandidate(trigger.dataset.candidateId, trigger.dataset.assignedRole);
    return;
  }

  if (trigger.dataset.action === "unbind-candidate") {
    handleUnbindCandidate(trigger.dataset.candidateId);
  }
}

function handleLifecyclePlanClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }

  if (trigger.dataset.action === "rebind-live-role") {
    handleBindCandidate(trigger.dataset.candidateId, trigger.dataset.assignedRole);
    return;
  }

  if (trigger.dataset.action === "unbind-candidate") {
    handleUnbindCandidate(trigger.dataset.candidateId);
  }
}

function handleRoleMapClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }

  if (trigger.dataset.action === "test-output") {
    handleTestOutput(trigger.dataset.role, trigger.dataset.target);
  }
}

function handleSectionClick(event) {
  const trigger = event.target.closest("[data-section]");
  if (!trigger) {
    return;
  }

  state.activeSection = trigger.dataset.section;
  renderWorkspaceHeader();
  renderSidebar();
}

function openSection(section) {
  state.activeSection = section;
  renderWorkspaceHeader();
  renderSidebar();
}

function handleConversationSearch(event) {
  state.conversationSearch = event.target.value;
  renderConversationFilters();
}

function handleConversationSort(event) {
  state.conversationSort = event.target.value;
  renderConversationFilters();
}

function handleChatHeaderAction(action) {
  if (action === "identities") {
    openSection("identities");
    return;
  }

  if (action === "relay") {
    openSection("relay");
    return;
  }

  if (action === "pull-route") {
    handlePull(getComposerTargetRole());
  }
}

elements.refreshAll.addEventListener("click", () => {
  loadState().catch((error) => {
    setPanel(elements.composerSendResult, escapeHtml(error.message), true);
  });
});

elements.composerRoleSender.addEventListener("click", () => {
  state.preferredFromRole = "sender";
  renderComposer();
});

elements.composerRoleReceiver.addEventListener("click", () => {
  state.preferredFromRole = "receiver";
  renderComposer();
  renderSelectedChatHeader();
});

for (const navItem of elements.navItems) {
  navItem.addEventListener("click", handleSectionClick);
}

elements.conversationSearch.addEventListener("input", handleConversationSearch);
elements.conversationSort.addEventListener("change", handleConversationSort);
elements.chatOpenIdentities.addEventListener("click", () => handleChatHeaderAction("identities"));
elements.chatOpenRelay.addEventListener("click", () => handleChatHeaderAction("relay"));
elements.chatPullRoute.addEventListener("click", () => handleChatHeaderAction("pull-route"));
elements.diagPullAll.addEventListener("click", handlePullAll);
elements.diagRefreshDiscovery.addEventListener("click", handleRefreshDiscovery);
elements.diagToggleDiscoveryAuto.addEventListener("click", handleToggleDiscoveryAuto);
elements.diagApplyBindings.addEventListener("click", handleApplyBindings);
elements.diagAdoptLiveBindings.addEventListener("click", handleAdoptLiveBindings);
elements.diagReconcileLiveState.addEventListener("click", handleReconcileLiveState);
elements.diagClearConflictingBindings.addEventListener("click", handleClearConflictingBindings);
elements.diagClearAppliedPlan.addEventListener("click", handleClearAppliedPlan);
elements.diagOpenChats.addEventListener("click", () => openSection("chats"));
elements.diagOpenRelay.addEventListener("click", () => openSection("relay"));
elements.composerSendForm.addEventListener("submit", handleSend);
elements.pullSender.addEventListener("click", () => handlePull("sender"));
elements.pullReceiver.addEventListener("click", () => handlePull("receiver"));
elements.conversationList.addEventListener("click", handleConversationClick);
elements.conversationFilters.addEventListener("click", handleConversationClick);
elements.relayQueueList.addEventListener("click", handleRelayQueueClick);
elements.discoveryCandidates.addEventListener("click", handleDiscoveryClick);
elements.bindingHintsList.addEventListener("click", handleDiscoveryClick);
elements.lifecyclePlanList.addEventListener("click", handleLifecyclePlanClick);
elements.roleMapList.addEventListener("click", handleRoleMapClick);

loadState().catch((error) => {
  setPanel(elements.composerSendResult, escapeHtml(error.message), true);
});
