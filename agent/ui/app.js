const TRANSPORT_HISTORY_LIMIT = 24;

const state = {
  agent: null,
  identity: null,
  identityCached: false,
  peers: [],
  outbox: [],
  messages: [],
  receipts: [],
  selectedPeerKeyId: "",
  transportSync: null,
  transportStorageKey: null,
  transportPanel: {
    current: null,
    history: []
  }
};

const elements = {
  agentName: document.getElementById("agent-name"),
  agentTransport: document.getElementById("agent-transport"),
  agentStateDir: document.getElementById("agent-state-dir"),
  agentRemoteUrl: document.getElementById("agent-remote-url"),
  agentTargetAgent: document.getElementById("agent-target-agent"),
  identityStatus: document.getElementById("identity-status"),
  identityAlgorithm: document.getElementById("identity-algorithm"),
  identityCurve: document.getElementById("identity-curve"),
  identityKeyId: document.getElementById("identity-key-id"),
  identityFingerprint: document.getElementById("identity-fingerprint"),
  identityError: document.getElementById("identity-error"),
  peersCount: document.getElementById("peers-count"),
  peersList: document.getElementById("peers-list"),
  clearConversationFilter: document.getElementById("clear-conversation-filter"),
  composeContext: document.getElementById("compose-context"),
  recipientSelect: document.getElementById("recipient-select"),
  composeForm: document.getElementById("compose-form"),
  composeText: document.getElementById("compose-text"),
  composeSubmit: document.getElementById("compose-submit"),
  saveEnvelope: document.getElementById("save-envelope"),
  composeResult: document.getElementById("compose-result"),
  outboxCount: document.getElementById("outbox-count"),
  outboxScope: document.getElementById("outbox-scope"),
  outboxList: document.getElementById("outbox-list"),
  messagesCount: document.getElementById("messages-count"),
  messagesScope: document.getElementById("messages-scope"),
  messagesList: document.getElementById("messages-list"),
  messagesResult: document.getElementById("messages-result"),
  receiptsCount: document.getElementById("receipts-count"),
  receiptsList: document.getElementById("receipts-list"),
  receiveForm: document.getElementById("receive-form"),
  receivePath: document.getElementById("receive-path"),
  receiveResult: document.getElementById("receive-result"),
  exportBundle: document.getElementById("export-bundle"),
  transportSyncStatus: document.getElementById("transport-sync-status"),
  deliverBundleForm: document.getElementById("deliver-bundle-form"),
  remoteUrl: document.getElementById("remote-url"),
  targetAgent: document.getElementById("target-agent"),
  importBundleForm: document.getElementById("import-bundle-form"),
  bundlePath: document.getElementById("bundle-path"),
  transportResult: document.getElementById("transport-result"),
  transportHistory: document.getElementById("transport-history"),
  transportHistorySummary: document.getElementById("transport-history-summary"),
  transportHistoryList: document.getElementById("transport-history-list"),
  pullRelay: document.getElementById("pull-relay"),
  refreshAll: document.getElementById("refresh-all"),
  rememberSelf: document.getElementById("remember-self")
};

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return payload;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatStatus(status) {
  const labels = {
    saved: "Saved",
    packaged: "Packaged",
    queued_relay: "Queued in relay",
    delivered_local: "Delivered local",
    delivered_file: "Delivered from file",
    delivered_bundle: "Delivered by bundle",
    delivered_remote: "Delivered remote",
    delivered_remote_ack: "Remote acknowledged",
    read_remote: "Read by remote",
    accepted_remote: "Accepted"
  };

  return labels[status] ?? status ?? "unknown";
}

function getTransportStorageKey() {
  const agentName = state.agent?.name ?? "unknown-agent";
  const stateDir = state.agent?.stateDir ?? "unknown-state";
  return `esp-messenger:transport-results:${agentName}:${stateDir}`;
}

function saveTransportPanelState() {
  if (!state.transportStorageKey) {
    return;
  }

  try {
    window.localStorage.setItem(
      state.transportStorageKey,
      JSON.stringify(state.transportPanel)
    );
  } catch {}
}

function loadTransportPanelState() {
  const nextKey = getTransportStorageKey();
  if (state.transportStorageKey === nextKey) {
    return;
  }

  state.transportStorageKey = nextKey;
  state.transportPanel = {
    current: null,
    history: []
  };

  try {
    const raw = window.localStorage.getItem(nextKey);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    state.transportPanel = {
      current: parsed?.current ?? null,
      history: Array.isArray(parsed?.history) ? parsed.history : []
    };
  } catch {}
}

function createTransportEntry({ label, html, isError = false }) {
  return {
    id: `transport-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    label,
    html,
    isError,
    createdAt: new Date().toISOString()
  };
}

function storeTransportResult(entry) {
  if (state.transportPanel.current) {
    state.transportPanel.history.unshift(state.transportPanel.current);
    state.transportPanel.history = state.transportPanel.history.slice(0, TRANSPORT_HISTORY_LIMIT);
  }

  state.transportPanel.current = entry;
  saveTransportPanelState();
  renderTransportPanels();
}

function showTransportResult({ label, html, isError = false }) {
  storeTransportResult(createTransportEntry({ label, html, isError }));
}

function reopenTransportHistoryEntry(entryId) {
  const entry = state.transportPanel.history.find((item) => item.id === entryId);
  if (!entry) {
    return;
  }

  state.transportPanel.history = state.transportPanel.history.filter((item) => item.id !== entryId);
  if (state.transportPanel.current) {
    state.transportPanel.history.unshift(state.transportPanel.current);
  }

  state.transportPanel.current = entry;
  state.transportPanel.history = state.transportPanel.history.slice(0, TRANSPORT_HISTORY_LIMIT);
  saveTransportPanelState();
  renderTransportPanels();
}

function deleteTransportHistoryEntry(entryId) {
  state.transportPanel.history = state.transportPanel.history.filter((item) => item.id !== entryId);
  saveTransportPanelState();
  renderTransportPanels();
}

function isConversationPeer(peer) {
  if (!peer) {
    return false;
  }

  if (!state.identity?.keyId) {
    return true;
  }

  return peer.keyId !== state.identity.keyId;
}

function getConversationPeers() {
  return state.peers.filter(isConversationPeer);
}

function getSelectedPeer() {
  return getConversationPeers().find((peer) => peer.keyId === state.selectedPeerKeyId) ?? null;
}

function ensureSelectedPeer() {
  const peers = getConversationPeers();
  if (state.selectedPeerKeyId && peers.some((peer) => peer.keyId === state.selectedPeerKeyId)) {
    return;
  }

  state.selectedPeerKeyId = peers.length === 1 ? peers[0].keyId : "";
}

function matchesPeerMessage(message, peerKeyId) {
  if (!peerKeyId) {
    return true;
  }

  return message.senderKeyId === peerKeyId || message.recipientKeyId === peerKeyId;
}

function getConversationMessages(peerKeyId = state.selectedPeerKeyId) {
  return state.messages.filter((message) => matchesPeerMessage(message, peerKeyId));
}

function getConversationOutbox(peerKeyId = state.selectedPeerKeyId) {
  return state.outbox.filter((message) => matchesPeerMessage(message, peerKeyId));
}

function getConversationReceipts(peerKeyId = state.selectedPeerKeyId) {
  if (!peerKeyId) {
    return state.receipts;
  }

  const relatedMessageIds = new Set([
    ...getConversationMessages(peerKeyId).map((message) => message.messageId),
    ...getConversationOutbox(peerKeyId).map((message) => message.messageId)
  ]);

  return state.receipts.filter(
    (receipt) =>
      relatedMessageIds.has(receipt.messageId) ||
      relatedMessageIds.has(receipt.envelopeId) ||
      receipt.senderKeyId === peerKeyId
  );
}

function getConversationSummary(peerKeyId) {
  const messages = getConversationMessages(peerKeyId);
  const outbox = getConversationOutbox(peerKeyId);
  const unreadCount = messages.filter(
    (message) => message.direction === "inbound" && !message.readAt
  ).length;

  const latest = [...messages, ...outbox]
    .sort((left, right) =>
      (right.envelopeCreatedAt ?? right.createdAt ?? "").localeCompare(
        left.envelopeCreatedAt ?? left.createdAt ?? ""
      )
    )[0] ?? null;

  return {
    unreadCount,
    latestPreview: latest?.textPreview ?? "No messages yet",
    totalCount: messages.length + outbox.length
  };
}

function syncRecipientSelect() {
  const peers = getConversationPeers();
  const previousValue = elements.recipientSelect.value;
  elements.recipientSelect.innerHTML = '<option value="">Без адресата</option>';

  for (const peer of peers) {
    elements.recipientSelect.insertAdjacentHTML(
      "beforeend",
      `<option value="${escapeHtml(peer.keyId)}">${escapeHtml(peer.label ?? peer.keyId)}</option>`
    );
  }

  const desiredValue =
    peers.some((peer) => peer.keyId === previousValue)
      ? previousValue
      : peers.some((peer) => peer.keyId === state.selectedPeerKeyId)
        ? state.selectedPeerKeyId
        : "";
  elements.recipientSelect.value = desiredValue;
}

function renderAgent() {
  const agent = state.agent ?? {};

  elements.agentName.textContent = agent.name ?? "unknown-agent";
  elements.agentTransport.textContent = agent.transport ?? "offline";
  elements.agentStateDir.textContent = agent.stateDir ?? "—";
  elements.agentRemoteUrl.textContent = agent.remoteUrl ?? "not configured";
  elements.agentTargetAgent.textContent = agent.targetAgent ?? "not configured";
  elements.remoteUrl.value = agent.remoteUrl ?? elements.remoteUrl.value;
  elements.targetAgent.value = agent.targetAgent ?? elements.targetAgent.value;
}

function renderTransportSync() {
  const sync = state.transportSync;
  if (!sync?.enabled) {
    elements.transportSyncStatus.textContent = "Автосинхронизация relay отключена.";
    return;
  }

  const mode = sync.lastError
    ? `Ошибка: ${sync.lastError}`
    : sync.lastSuccessAt
      ? `Последний успех: ${sync.lastSuccessAt}`
      : "Ожидается первый auto-pull.";
  elements.transportSyncStatus.textContent =
    `Автосинхронизация каждые ${sync.intervalMs} мс. ${mode}`;
}

function renderTransportPanels() {
  const current = state.transportPanel.current;
  if (current) {
    setPanel(elements.transportResult, current.html, current.isError);
  } else {
    clearPanel(elements.transportResult);
  }

  const history = state.transportPanel.history;
  if (!history.length) {
    elements.transportHistory.classList.add("hidden");
    elements.transportHistorySummary.textContent = "История transport-результатов";
    elements.transportHistoryList.innerHTML = "";
    return;
  }

  elements.transportHistory.classList.remove("hidden");
  elements.transportHistorySummary.textContent = `История transport-результатов (${history.length})`;
  elements.transportHistoryList.innerHTML = history
    .map((entry) => `
      <article class="history-item ${entry.isError ? "error" : ""}">
        <div class="history-item-topline">
          <div>
            <div class="history-item-title">${escapeHtml(entry.label ?? "Transport result")}</div>
            <div class="result-meta">${escapeHtml(entry.createdAt ?? "—")}</div>
          </div>
          <span class="status-pill">${escapeHtml(entry.isError ? "Error" : "Saved")}</span>
        </div>
        <div>${entry.html}</div>
        <div class="history-item-actions">
          <button
            class="button button-secondary button-small"
            type="button"
            data-action="open-transport-history"
            data-entry-id="${escapeHtml(entry.id)}"
          >
            Открыть
          </button>
          <button
            class="button button-secondary button-small"
            type="button"
            data-action="delete-transport-history"
            data-entry-id="${escapeHtml(entry.id)}"
          >
            Удалить
          </button>
        </div>
      </article>
    `)
    .join("");
}

function renderIdentity() {
  if (!state.identity) {
    elements.identityStatus.textContent = "Offline";
    elements.identityAlgorithm.textContent = "—";
    elements.identityCurve.textContent = "—";
    elements.identityKeyId.textContent = "—";
    elements.identityFingerprint.textContent = "—";
    elements.composeSubmit.disabled = true;
    elements.rememberSelf.disabled = true;
    return;
  }

  elements.identityStatus.textContent = state.identityCached ? "Cached" : "Connected";
  elements.identityAlgorithm.textContent = state.identity.algorithm ?? "—";
  elements.identityCurve.textContent = state.identity.curve ?? "—";
  elements.identityKeyId.textContent = state.identity.keyId ?? "—";
  elements.identityFingerprint.textContent = state.identity.fingerprintHex ?? "—";
  elements.composeSubmit.disabled = false;
  elements.rememberSelf.disabled = false;
}

function renderPeers() {
  ensureSelectedPeer();
  syncRecipientSelect();

  const peers = getConversationPeers();
  const selectedPeer = getSelectedPeer();
  elements.peersCount.textContent = String(peers.length);

  elements.composeContext.textContent = selectedPeer
    ? `Текущий диалог: ${selectedPeer.label ?? selectedPeer.keyId}`
    : "Сейчас показан весь трафик. Выбери peer, чтобы перейти в диалог.";

  if (!peers.length) {
    elements.peersList.className = "stack-list empty-state";
    elements.peersList.textContent =
      "Контактов пока нет. Входящее сообщение создаст первый peer автоматически.";
    return;
  }

  elements.peersList.className = "stack-list";
  elements.peersList.innerHTML = peers
    .map((peer) => {
      const summary = getConversationSummary(peer.keyId);
      const isActive = state.selectedPeerKeyId === peer.keyId;

      return `
        <button
          class="conversation-card ${isActive ? "active" : ""}"
          type="button"
          data-action="select-peer"
          data-peer-key-id="${escapeHtml(peer.keyId)}"
        >
          <div class="peer-topline">
            <span class="peer-label">${escapeHtml(peer.label ?? "Unnamed peer")}</span>
            <span class="status-pill">${escapeHtml(peer.role ?? "peer")}</span>
          </div>
          <div class="conversation-meta-grid">
            <div class="peer-meta mono">${escapeHtml(peer.keyId)}</div>
            <div class="peer-meta">Источник: ${escapeHtml(peer.source ?? "—")}</div>
            <div class="peer-meta">Сообщений: ${escapeHtml(summary.totalCount)}</div>
            <div class="peer-meta">Непрочитано: ${escapeHtml(summary.unreadCount)}</div>
          </div>
          <div class="message-body">${escapeHtml(summary.latestPreview)}</div>
        </button>
      `;
    })
    .join("");
}

function renderOutbox() {
  const selectedPeer = getSelectedPeer();
  const outbox = getConversationOutbox();

  elements.outboxCount.textContent = String(outbox.length);
  elements.outboxScope.textContent = selectedPeer
    ? `Исходящие сообщения для ${selectedPeer.label ?? selectedPeer.keyId}`
    : "Показаны все исходящие сообщения агента.";

  if (!outbox.length) {
    elements.outboxList.className = "message-list empty-state";
    elements.outboxList.textContent = "Под выбранный диалог исходящих сообщений пока нет.";
    return;
  }

  elements.outboxList.className = "message-list";
  elements.outboxList.innerHTML = outbox
    .map((message) => {
      const recipientLabel = message.recipientKeyId ?? "broadcast/local";
      const canReceive = !String(message.status ?? "").startsWith("delivered");
      const readLine = message.readAt
        ? `<div class="outbox-meta">Read at: ${escapeHtml(message.readAt)}</div>`
        : "";

      return `
        <article class="message-item">
          <div class="outbox-topline">
            <span class="outbox-title">${escapeHtml(message.textPreview ?? "Без текста")}</span>
            <span class="status-pill">${escapeHtml(formatStatus(message.status))}</span>
          </div>
          <div class="outbox-meta mono">${escapeHtml(message.messageId)}</div>
          <div class="outbox-meta">${escapeHtml(message.envelopeCreatedAt ?? "—")}</div>
          <div class="outbox-meta">Recipient: ${escapeHtml(recipientLabel)}</div>
          <div class="outbox-meta">Remote: ${escapeHtml(message.remoteAgent ?? "—")}</div>
          <div class="outbox-meta">Queue: ${escapeHtml(message.queueId ?? "—")}</div>
          <div class="outbox-meta">Receipt: ${escapeHtml(message.readReceiptId ?? message.deliveryReceiptId ?? message.relayReceiptId ?? "—")}</div>
          ${readLine}
          <div class="outbox-actions">
            <button
              class="button button-secondary button-small"
              type="button"
              data-action="receive-outbox"
              data-message-id="${escapeHtml(message.messageId)}"
              ${canReceive ? "" : "disabled"}
            >
              ${canReceive ? "Принять локально" : "Уже доставлено"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMessages() {
  const selectedPeer = getSelectedPeer();
  const messages = getConversationMessages();

  elements.messagesCount.textContent = String(messages.length);
  elements.messagesScope.textContent = selectedPeer
    ? `История диалога с ${selectedPeer.label ?? selectedPeer.keyId}`
    : "Показана общая входящая и локальная история.";

  if (!messages.length) {
    elements.messagesList.className = "message-list empty-state";
    elements.messagesList.textContent = "Под выбранный диалог сообщений пока нет.";
    return;
  }

  elements.messagesList.className = "message-list";
  elements.messagesList.innerHTML = messages
    .map((message) => {
      const title =
        message.direction === "self"
          ? "Локальное сообщение"
          : message.peerLabel ?? message.senderKeyId ?? "Unknown sender";
      const canMarkRead =
        message.direction === "inbound" &&
        !message.readAt &&
        Boolean(message.sourceAgent);
      const readLine = message.readAt
        ? `<div class="message-meta">Read locally: ${escapeHtml(message.readAt)}</div>`
        : "";

      return `
        <article class="message-item">
          <div class="message-topline">
            <span class="message-title">${escapeHtml(title)}</span>
            <span class="status-pill">${escapeHtml(message.readAt ? "Read" : message.direction ?? "inbound")}</span>
          </div>
          <div class="message-meta mono">${escapeHtml(message.senderKeyId ?? "—")}</div>
          <div class="message-meta">${escapeHtml(message.envelopeCreatedAt ?? "—")}</div>
          <div class="message-meta">Source agent: ${escapeHtml(message.sourceAgent ?? "—")}</div>
          ${readLine}
          <div class="message-body">${escapeHtml(message.textPreview ?? "Нет текстового preview")}</div>
          ${
            canMarkRead
              ? `
                <div class="message-actions">
                  <button
                    class="button button-primary button-small"
                    type="button"
                    data-action="mark-read"
                    data-message-id="${escapeHtml(message.messageId)}"
                  >
                    Отметить как прочитанное
                  </button>
                </div>
              `
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderReceipts() {
  const receipts = getConversationReceipts();
  elements.receiptsCount.textContent = String(receipts.length);

  if (!receipts.length) {
    elements.receiptsList.className = "message-list empty-state";
    elements.receiptsList.textContent = "Квитанций под текущий контекст пока нет.";
    return;
  }

  elements.receiptsList.className = "message-list";
  elements.receiptsList.innerHTML = receipts
    .map((receipt) => {
      const timeLabel = receipt.readAt ?? receipt.acceptedAt ?? receipt.createdAt ?? "—";

      return `
        <article class="message-item">
          <div class="message-topline">
            <span class="message-title">${escapeHtml(receipt.receiverAgent ?? "receiver")}</span>
            <span class="status-pill">${escapeHtml(formatStatus(receipt.status))}</span>
          </div>
          <div class="message-meta mono">${escapeHtml(receipt.receiptId ?? "—")}</div>
          <div class="message-meta">${escapeHtml(timeLabel)}</div>
          <div class="message-meta">Source: ${escapeHtml(receipt.sourceAgent ?? "—")}</div>
          <div class="message-meta">Relay: ${escapeHtml(receipt.relayName ?? "—")}</div>
        </article>
      `;
    })
    .join("");
}

function renderAll() {
  renderAgent();
  renderIdentity();
  renderTransportSync();
  renderTransportPanels();
  renderPeers();
  renderOutbox();
  renderMessages();
  renderReceipts();
}

async function loadState() {
  elements.identityError.classList.add("hidden");

  const payload = await fetchJson("/app/state");
  state.agent = payload.agent ?? null;
  state.identity = payload.identity ?? null;
  state.identityCached = Boolean(payload.identityCached);
  state.peers = payload.peers ?? [];
  state.outbox = payload.outbox ?? [];
  state.messages = payload.messages ?? [];
  state.receipts = payload.receipts ?? [];
  state.transportSync = payload.transportSync ?? null;
  loadTransportPanelState();

  ensureSelectedPeer();
  renderAll();

  if (payload.identityError) {
    elements.identityStatus.textContent = payload.identity ? "Cached" : "Unavailable";
    elements.identityError.textContent = payload.identity
      ? `Live poll failed: ${payload.identityError}`
      : payload.identityError;
    elements.identityError.classList.remove("hidden");
  }
}

async function handleRememberSelf() {
  try {
    await fetchJson("/identity/remember-self", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    await loadState();
  } catch (error) {
    elements.identityError.textContent = error.message;
    elements.identityError.classList.remove("hidden");
  }
}

async function handleComposeSubmit(event) {
  event.preventDefault();
  clearPanel(elements.composeResult);

  try {
    const payload = await fetchJson("/envelopes/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: elements.composeText.value,
        toKeyId: elements.recipientSelect.value || null,
        save: elements.saveEnvelope.checked
      })
    });

    setPanel(
      elements.composeResult,
      `
        <div class="result-meta"><strong>Envelope готов.</strong></div>
        <div class="result-meta">Locally verified: ${payload.locallyVerified ? "yes" : "no"}</div>
        <div class="result-meta">Recipient: ${escapeHtml(elements.recipientSelect.value || "broadcast/local")}</div>
        ${payload.filePath ? `<div class="result-meta mono">${escapeHtml(payload.filePath)}</div>` : ""}
      `
    );

    if (payload.filePath) {
      elements.receivePath.value = payload.filePath;
    }

    elements.composeText.value = "";
    await loadState();
  } catch (error) {
    setPanel(elements.composeResult, escapeHtml(error.message), true);
  }
}

async function handleReceiveSubmit(event) {
  event.preventDefault();
  clearPanel(elements.receiveResult);

  try {
    const payload = await fetchJson("/envelopes/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: elements.receivePath.value
      })
    });

    setPanel(
      elements.receiveResult,
      `
        <div class="result-meta"><strong>Envelope принят.</strong></div>
        <div class="result-meta mono">${escapeHtml(payload.result.message.messageId)}</div>
        <div class="result-meta">${escapeHtml(payload.result.message.textPreview ?? "Без preview")}</div>
      `
    );

    await loadState();
  } catch (error) {
    setPanel(elements.receiveResult, escapeHtml(error.message), true);
  }
}

async function handleOutboxActionClick(event) {
  const trigger = event.target.closest("[data-action='receive-outbox']");
  if (!trigger) {
    return;
  }

  trigger.disabled = true;

  try {
    const payload = await fetchJson("/outbox/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: trigger.dataset.messageId
      })
    });

    setPanel(
      elements.receiveResult,
      `
        <div class="result-meta"><strong>Envelope принят из outbox.</strong></div>
        <div class="result-meta mono">${escapeHtml(payload.result.message.messageId)}</div>
        <div class="result-meta">${escapeHtml(payload.result.message.textPreview ?? "Без preview")}</div>
      `
    );

    await loadState();
  } catch (error) {
    trigger.disabled = false;
    setPanel(elements.receiveResult, escapeHtml(error.message), true);
  }
}

async function handleMessagesActionClick(event) {
  const trigger = event.target.closest("[data-action='mark-read']");
  if (!trigger) {
    return;
  }

  trigger.disabled = true;
  clearPanel(elements.messagesResult);

  try {
    const payload = await fetchJson("/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: trigger.dataset.messageId
      })
    });

    setPanel(
      elements.messagesResult,
      `
        <div class="result-meta"><strong>Сообщение отмечено как прочитанное.</strong></div>
        <div class="result-meta mono">${escapeHtml(payload.result.receipt.receiptId)}</div>
        <div class="result-meta">Forwarded: ${payload.result.forwarded ? "yes" : "no"}</div>
      `
    );

    await loadState();
  } catch (error) {
    trigger.disabled = false;
    setPanel(elements.messagesResult, escapeHtml(error.message), true);
  }
}

async function handleExportBundle() {
  try {
    const payload = await fetchJson("/transport/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    if (payload.result?.filePath) {
      elements.bundlePath.value = payload.result.filePath;
    }

    showTransportResult({
      label: "Экспорт bundle",
      html: `
        <div class="result-meta"><strong>Bundle экспортирован.</strong></div>
        <div class="result-meta">Messages: ${escapeHtml(payload.result.messageCount)}</div>
        <div class="result-meta mono">${escapeHtml(payload.result.filePath)}</div>
      `
    });

    await loadState();
  } catch (error) {
    showTransportResult({
      label: "Экспорт bundle",
      html: escapeHtml(error.message),
      isError: true
    });
  }
}

async function handleDeliverBundle(event) {
  event.preventDefault();

  try {
    const payload = await fetchJson("/transport/deliver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        remoteUrl: elements.remoteUrl.value,
        targetAgent: elements.targetAgent.value || null
      })
    });

    showTransportResult({
      label: "Доставка bundle",
      html: `
        <div class="result-meta"><strong>${payload.result.queued ? "Bundle поставлен в очередь relay." : "Bundle доставлен."}</strong></div>
        <div class="result-meta">Messages: ${escapeHtml(payload.result.messageCount)}</div>
        <div class="result-meta">Remote agent: ${escapeHtml(payload.result.remoteAgent?.name ?? "unknown-agent")}</div>
        <div class="result-meta">Target agent: ${escapeHtml(payload.result.targetAgent ?? "direct")}</div>
        <div class="result-meta">Queued: ${payload.result.queued ? "yes" : "no"}</div>
        <div class="result-meta">Queue ID: ${escapeHtml(payload.result.queueId ?? "—")}</div>
        <div class="result-meta">Queue reason: ${escapeHtml(payload.result.queueReason ?? "—")}</div>
        <div class="result-meta">Relay receipt: ${escapeHtml(payload.result.relayReceiptId ?? "—")}</div>
        <div class="result-meta">Delivery receipts: ${escapeHtml(payload.result.receipts?.length ?? 0)}</div>
        <div class="result-meta">Queue error: ${escapeHtml(payload.result.queueError ?? "—")}</div>
        <div class="result-meta mono">${escapeHtml(payload.result.remoteUrl)}</div>
      `
    });

    await loadState();
  } catch (error) {
    showTransportResult({
      label: "Доставка bundle",
      html: escapeHtml(error.message),
      isError: true
    });
  }
}

async function handlePullRelay() {
  try {
    const payload = await fetchJson("/transport/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        remoteUrl: elements.remoteUrl.value
      })
    });

    showTransportResult({
      label: "Pull из relay",
      html: `
        <div class="result-meta"><strong>Relay queue sync завершён.</strong></div>
        <div class="result-meta">Target agent: ${escapeHtml(payload.result.targetAgent ?? "—")}</div>
        <div class="result-meta">Pulled: ${escapeHtml(payload.result.pulledCount ?? 0)}</div>
        <div class="result-meta">Delivered: ${escapeHtml(payload.result.deliveredCount ?? 0)}</div>
        <div class="result-meta">Failed: ${escapeHtml(payload.result.failedCount ?? 0)}</div>
        <div class="result-meta">Remaining: ${escapeHtml(payload.result.remainingCount ?? 0)}</div>
        <div class="result-meta mono">${escapeHtml(payload.result.remoteUrl ?? "")}</div>
      `
    });

    await loadState();
  } catch (error) {
    showTransportResult({
      label: "Pull из relay",
      html: escapeHtml(error.message),
      isError: true
    });
  }
}

async function handleImportBundle(event) {
  event.preventDefault();

  try {
    const payload = await fetchJson("/transport/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: elements.bundlePath.value
      })
    });

    showTransportResult({
      label: "Импорт bundle",
      html: `
        <div class="result-meta"><strong>Bundle импортирован.</strong></div>
        <div class="result-meta">Accepted: ${escapeHtml(payload.result.messageCount)}</div>
        <div class="result-meta mono">${escapeHtml(payload.result.filePath)}</div>
      `
    });

    await loadState();
  } catch (error) {
    showTransportResult({
      label: "Импорт bundle",
      html: escapeHtml(error.message),
      isError: true
    });
  }
}

function handlePeerSelectionClick(event) {
  const trigger = event.target.closest("[data-action='select-peer']");
  if (!trigger) {
    return;
  }

  state.selectedPeerKeyId = trigger.dataset.peerKeyId ?? "";
  renderAll();
}

function handleTransportHistoryClick(event) {
  const openTrigger = event.target.closest("[data-action='open-transport-history']");
  if (openTrigger) {
    reopenTransportHistoryEntry(openTrigger.dataset.entryId);
    return;
  }

  const deleteTrigger = event.target.closest("[data-action='delete-transport-history']");
  if (deleteTrigger) {
    deleteTransportHistoryEntry(deleteTrigger.dataset.entryId);
  }
}

function clearConversationFilter() {
  state.selectedPeerKeyId = "";
  renderAll();
}

elements.refreshAll.addEventListener("click", () => {
  loadState().catch((error) => {
    elements.identityError.textContent = error.message;
    elements.identityError.classList.remove("hidden");
  });
});
elements.rememberSelf.addEventListener("click", handleRememberSelf);
elements.composeForm.addEventListener("submit", handleComposeSubmit);
elements.receiveForm.addEventListener("submit", handleReceiveSubmit);
elements.outboxList.addEventListener("click", handleOutboxActionClick);
elements.messagesList.addEventListener("click", handleMessagesActionClick);
elements.peersList.addEventListener("click", handlePeerSelectionClick);
elements.clearConversationFilter.addEventListener("click", clearConversationFilter);
elements.exportBundle.addEventListener("click", handleExportBundle);
elements.pullRelay.addEventListener("click", handlePullRelay);
elements.deliverBundleForm.addEventListener("submit", handleDeliverBundle);
elements.importBundleForm.addEventListener("submit", handleImportBundle);
elements.transportHistoryList.addEventListener("click", handleTransportHistoryClick);

loadState().catch((error) => {
  elements.identityError.textContent = error.message;
  elements.identityError.classList.remove("hidden");
});
