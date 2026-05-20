const state = {
  user: null,
  authMode: "login",
  conversations: [],
  activeConversationId: null,
  messages: [],
  selectedPeople: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const authView = $("#authView");
const appView = $("#appView");
const authForm = $("#authForm");
const authNotice = $("#authNotice");
const authSubmit = $("#authSubmit");
const resendButton = $("#resendButton");
const conversationList = $("#conversationList");
const messagesEl = $("#messages");
const messageForm = $("#messageForm");
const messageInput = $("#messageInput");
const composeDialog = $("#composeDialog");
const composeForm = $("#composeForm");
const peopleResults = $("#peopleResults");
const selectedPeople = $("#selectedPeople");
const composeNotice = $("#composeNotice");

function formatTime(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    credentials: "same-origin",
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
  }
  return data;
}

function setNotice(element, message, tone = "neutral") {
  element.textContent = message ?? "";
  element.dataset.tone = tone;
}

function setAuthMode(mode) {
  state.authMode = mode;
  document.body.dataset.authMode = mode;
  authSubmit.textContent = mode === "login" ? "Sign in" : "Create account";
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
}

function showApp(user) {
  state.user = user;
  $("#userName").textContent = user.name;
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function showAuth() {
  state.user = null;
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
}

async function loadMe() {
  const data = await api("/api/auth?action=me");
  if (data.user) {
    showApp(data.user);
    await loadConversations();
  } else {
    showAuth();
  }
}

async function verifyFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("verify");
  if (!token) {
    return;
  }

  try {
    const data = await api(`/api/auth?action=verify&token=${encodeURIComponent(token)}`);
    setNotice(authNotice, data.message, "success");
    setAuthMode("login");
  } catch (error) {
    setNotice(authNotice, error.message, "danger");
  } finally {
    url.searchParams.delete("verify");
    window.history.replaceState({}, "", url);
  }
}

function conversationMatches(conversation, query) {
  const haystack = [
    conversation.title,
    conversation.priority,
    conversation.members.map((member) => member.name).join(" "),
    conversation.lastMessage?.body,
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function renderConversations() {
  const query = $("#conversationSearch").value.trim();
  const visible = state.conversations.filter((conversation) => conversationMatches(conversation, query));

  conversationList.innerHTML = visible
    .map((conversation) => {
      const participants = conversation.members
        .filter((member) => member.id !== state.user.id)
        .map((member) => member.name)
        .join(", ") || "You";
      const active = conversation.id === state.activeConversationId ? "active" : "";
      const unread = conversation.unread ? `<span class="badge">${conversation.unread}</span>` : "";
      return `
        <button class="conversation ${active}" data-id="${conversation.id}">
          <span class="conversation-top">
            <strong>${escapeHtml(conversation.title)}</strong>
            ${unread}
          </span>
          <span>${escapeHtml(participants)}</span>
          <small>${escapeHtml(conversation.lastMessage?.body ?? "No messages yet")}</small>
        </button>
      `;
    })
    .join("");

  if (!visible.length) {
    conversationList.innerHTML = '<div class="empty">No conversations found.</div>';
  }
}

function renderThread() {
  const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
  if (!conversation) {
    $("#threadTitle").textContent = "Choose a thread";
    $("#threadMeta").textContent = "No conversation selected";
    messagesEl.innerHTML = '<div class="empty centered">Create or select a conversation to start messaging.</div>';
    messageInput.disabled = true;
    messageForm.querySelector("button").disabled = true;
    return;
  }

  const others = conversation.members
    .filter((member) => member.id !== state.user.id)
    .map((member) => member.name)
    .join(", ") || "Personal notes";
  $("#threadTitle").textContent = conversation.title;
  $("#threadMeta").textContent = `${conversation.priority.toUpperCase()} / ${others}`;
  messageInput.disabled = false;
  messageForm.querySelector("button").disabled = false;

  messagesEl.innerHTML = state.messages
    .map((message) => {
      const mine = message.sender?.id === state.user.id ? "mine" : "";
      return `
        <article class="message ${mine}">
          <div class="message-meta">
            <strong>${escapeHtml(message.sender?.name ?? "Unknown")}</strong>
            <span>${formatTime(message.createdAt)}</span>
          </div>
          <p>${escapeHtml(message.body)}</p>
        </article>
      `;
    })
    .join("");

  if (!state.messages.length) {
    messagesEl.innerHTML = '<div class="empty centered">No messages in this thread yet.</div>';
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function loadConversations() {
  const data = await api("/api/messages");
  state.conversations = data.conversations;
  renderConversations();

  if (!state.activeConversationId && state.conversations[0]) {
    await openConversation(state.conversations[0].id);
  } else {
    renderThread();
  }
}

async function openConversation(id) {
  state.activeConversationId = id;
  const data = await api(`/api/messages?action=thread&id=${encodeURIComponent(id)}`);
  state.messages = data.messages;
  state.conversations = state.conversations.map((conversation) =>
    conversation.id === id ? data.conversation : conversation,
  );
  renderConversations();
  renderThread();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function searchPeople() {
  const query = $("#peopleSearch").value.trim();
  const data = await api(`/api/messages?action=directory&q=${encodeURIComponent(query)}`);
  peopleResults.innerHTML = data.users
    .filter((user) => !state.selectedPeople.has(user.id))
    .map((user) => `
      <button type="button" data-person="${user.id}">
        <span>
          <strong>${escapeHtml(user.name)}</strong>
          <small>${escapeHtml(user.email)}</small>
        </span>
        <span>Add</span>
      </button>
    `)
    .join("");

  if (!peopleResults.innerHTML) {
    peopleResults.innerHTML = '<div class="empty">No verified teammates found.</div>';
  }
}

function renderSelectedPeople() {
  selectedPeople.innerHTML = Array.from(state.selectedPeople.values())
    .map((user) => `
      <button type="button" data-remove-person="${user.id}">
        ${escapeHtml(user.name)}
        <span>x</span>
      </button>
    `)
    .join("");
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setNotice(authNotice, "");

  const body = {
    email: $("#emailInput").value,
    password: $("#passwordInput").value,
  };

  if (state.authMode === "register") {
    body.name = $("#nameInput").value;
  }

  try {
    const data = await api(`/api/auth?action=${state.authMode}`, {
      method: "POST",
      body,
    });

    if (state.authMode === "login") {
      showApp(data.user);
      await loadConversations();
      return;
    }

    setNotice(authNotice, data.verificationUrl ? `${data.message} ${data.verificationUrl}` : data.message, "success");
  } catch (error) {
    setNotice(authNotice, error.message, "danger");
  }
});

resendButton.addEventListener("click", async () => {
  try {
    const data = await api("/api/auth?action=resend", {
      method: "POST",
      body: { email: $("#emailInput").value },
    });
    setNotice(authNotice, data.verificationUrl ? `${data.message} ${data.verificationUrl}` : data.message, "success");
  } catch (error) {
    setNotice(authNotice, error.message, "danger");
  }
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.mode));
});

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/auth?action=logout", { method: "POST" });
  state.conversations = [];
  state.messages = [];
  state.activeConversationId = null;
  showAuth();
});

$("#refreshButton").addEventListener("click", loadConversations);
$("#conversationSearch").addEventListener("input", renderConversations);

conversationList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-id]");
  if (button) {
    await openConversation(button.dataset.id);
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = messageInput.value.trim();
  if (!body || !state.activeConversationId) {
    return;
  }

  const data = await api("/api/messages?action=send", {
    method: "POST",
    body: { conversationId: state.activeConversationId, body },
  });
  state.messages.push(data.message);
  state.conversations = state.conversations.map((conversation) =>
    conversation.id === data.conversation.id ? data.conversation : conversation,
  );
  messageInput.value = "";
  renderConversations();
  renderThread();
});

$("#newConversationButton").addEventListener("click", async () => {
  composeForm.reset();
  state.selectedPeople.clear();
  renderSelectedPeople();
  setNotice(composeNotice, "");
  composeDialog.showModal();
  await searchPeople();
});

$("#closeCompose").addEventListener("click", () => composeDialog.close());
$("#peopleSearch").addEventListener("input", searchPeople);

peopleResults.addEventListener("click", (event) => {
  const button = event.target.closest("[data-person]");
  if (!button) {
    return;
  }
  const user = {
    id: button.dataset.person,
    name: button.querySelector("strong").textContent,
    email: button.querySelector("small").textContent,
  };
  state.selectedPeople.set(user.id, user);
  renderSelectedPeople();
  searchPeople();
});

selectedPeople.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-person]");
  if (button) {
    state.selectedPeople.delete(button.dataset.removePerson);
    renderSelectedPeople();
    searchPeople();
  }
});

composeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setNotice(composeNotice, "");

  try {
    const data = await api("/api/messages?action=create", {
      method: "POST",
      body: {
        memberIds: Array.from(state.selectedPeople.keys()),
        title: $("#subjectInput").value,
        priority: $("#priorityInput").value,
        message: $("#firstMessageInput").value,
      },
    });
    composeDialog.close();
    await loadConversations();
    await openConversation(data.conversation.id);
  } catch (error) {
    setNotice(composeNotice, error.message, "danger");
  }
});

setAuthMode("login");
await verifyFromUrl();
await loadMe();
