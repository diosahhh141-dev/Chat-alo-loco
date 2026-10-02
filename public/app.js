(() => {
  const socket = io();
  const joinPanel = document.querySelector("#join-panel");
  const chatPanel = document.querySelector("#chat-panel");
  const joinForm = document.querySelector("#join-form");
  const messageForm = document.querySelector("#message-form");
  const messagesList = document.querySelector("#messages");
  const joinError = document.querySelector("#join-error");
  const roomInput = document.querySelector("#room");
  const usernameInput = document.querySelector("#username");
  const messageInput = document.querySelector("#message");
  let currentRoom = "";
  let currentUsername = "";
  const seenIds = new Set();

  const roomFromUrl = new URLSearchParams(location.search).get("sala");
  if (roomFromUrl && /^[a-z0-9_-]{3,24}$/i.test(roomFromUrl)) roomInput.value = roomFromUrl;

  function addNotice(text) {
    const item = document.createElement("li");
    item.className = "notice-item";
    item.textContent = text;
    messagesList.append(item);
    messagesList.scrollTop = messagesList.scrollHeight;
  }

  function addMessage(message) {
    if (seenIds.has(message.id)) return;
    seenIds.add(message.id);
    const item = document.createElement("li");
    item.className = `message-item${message.username === currentUsername ? " mine" : ""}`;

    const bubble = document.createElement("article");
    bubble.className = "bubble";
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const name = document.createElement("strong");
    name.textContent = message.username;
    const time = document.createElement("time");
    const date = new Date(message.time);
    time.dateTime = date.toISOString();
    time.textContent = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(date);
    const text = document.createElement("p");
    text.textContent = message.text;
    meta.append(name, time);
    bubble.append(meta, text);
    item.append(bubble);
    messagesList.append(item);
    messagesList.scrollTop = messagesList.scrollHeight;
  }

  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    joinError.textContent = "";
    currentUsername = usernameInput.value.trim().slice(0, 24);
    const room = roomInput.value.trim().toUpperCase();
    socket.emit("join-room", { username: currentUsername, room }, (result) => {
      if (!result?.ok) {
        joinError.textContent = result?.error || "No se pudo entrar. Inténtalo de nuevo.";
        return;
      }
      currentRoom = result.room;
      document.querySelector("#room-title").textContent = currentRoom;
      roomInput.value = currentRoom;
      history.replaceState(null, "", `?sala=${encodeURIComponent(currentRoom)}`);
      messagesList.replaceChildren();
      seenIds.clear();
      joinPanel.hidden = true;
      chatPanel.hidden = false;
      result.messages.forEach(addMessage);
      if (!result.messages.length) addNotice("¡Sala lista! Comparte el código y saluda a tus amigos.");
      messageInput.focus();
    });
  });

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentRoom) return;
    socket.emit("send-message", text);
    messageInput.value = "";
    messageInput.focus();
  });

  socket.on("message", addMessage);
  socket.on("notice", addNotice);
  socket.on("connect", () => {
    if (currentRoom) {
      socket.emit("join-room", { username: currentUsername, room: currentRoom }, (result) => {
        if (result?.ok) {
          messagesList.replaceChildren();
          seenIds.clear();
          result.messages.forEach(addMessage);
        }
      });
    }
    document.querySelector("#chat-notice").classList.remove("offline");
  });
  socket.on("disconnect", () => {
    document.querySelector("#chat-notice").textContent = "Se perdió la conexión. Intentando reconectar…";
    document.querySelector("#chat-notice").classList.add("offline");
  });

  document.querySelector("#leave").addEventListener("click", () => {
    currentRoom = "";
    currentUsername = "";
    history.replaceState(null, "", location.pathname);
    chatPanel.hidden = true;
    joinPanel.hidden = false;
    messagesList.replaceChildren();
  });

  document.querySelector("#copy-link").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const invite = `${location.origin}${location.pathname}?sala=${encodeURIComponent(currentRoom)}`;
    try {
      await navigator.clipboard.writeText(invite);
      button.textContent = "¡Enlace copiado!";
      setTimeout(() => { button.textContent = "Copiar invitación"; }, 1800);
    } catch {
      window.prompt("Copia este enlace para invitar a tus amigos:", invite);
    }
  });
})();
