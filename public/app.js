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
  const imageInput = document.querySelector("#image-file");
  const imagePreview = document.querySelector("#image-preview");
  const previewImage = document.querySelector("#preview-image");
  const replyPreview = document.querySelector("#reply-preview");
  const replyAuthor = document.querySelector("#reply-author");
  const replyText = document.querySelector("#reply-text");
  const chatNotice = document.querySelector("#chat-notice");
  let currentRoom = "";
  let currentUsername = "";
  let selectedImageData = "";
  let currentReplyTo = "";
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
    item.dataset.messageId = message.id;

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
    meta.append(name, time);
    bubble.append(meta);
    if (message.replyTo) {
      const quote = document.createElement("div");
      quote.className = "reply-quote";
      const quoteName = document.createElement("strong");
      quoteName.textContent = message.replyTo.username;
      const quoteContent = document.createElement("span");
      quoteContent.textContent = message.replyTo.text || (message.replyTo.hasImage ? "Imagen" : "Mensaje");
      quote.append(quoteName, quoteContent);
      bubble.append(quote);
    }
    if (message.text) {
      const text = document.createElement("p");
      text.textContent = message.text;
      bubble.append(text);
    }
    if (message.imageData) {
      const image = document.createElement("img");
      image.className = "chat-image";
      image.src = message.imageData;
      image.alt = `Imagen enviada por ${message.username}`;
      bubble.append(image);
    } else if (message.imageExpired) {
      const expired = document.createElement("p");
      expired.className = "image-expired";
      expired.textContent = "Esta imagen temporal ya no está disponible.";
      bubble.append(expired);
    }
    const replyButton = document.createElement("button");
    replyButton.className = "reply-action";
    replyButton.type = "button";
    replyButton.textContent = "↩ Responder";
    replyButton.setAttribute("aria-label", `Responder a ${message.username}`);
    replyButton.addEventListener("click", () => beginReply(message));
    bubble.append(replyButton);
    item.append(bubble);

    let touchStart = null;
    item.addEventListener("touchstart", (event) => {
      const touch = event.changedTouches[0];
      touchStart = { x: touch.clientX, y: touch.clientY };
    }, { passive: true });
    item.addEventListener("touchend", (event) => {
      if (!touchStart) return;
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - touchStart.x;
      const deltaY = touch.clientY - touchStart.y;
      touchStart = null;
      if (deltaX < -70 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) beginReply(message);
    }, { passive: true });

    messagesList.append(item);
    messagesList.scrollTop = messagesList.scrollHeight;
  }

  function beginReply(message) {
    currentReplyTo = message.id;
    replyAuthor.textContent = message.username;
    replyText.textContent = message.text || (message.imageData || message.imageExpired ? "Imagen" : "Mensaje");
    replyPreview.hidden = false;
    messageInput.focus();
  }

  function clearReply() {
    currentReplyTo = "";
    replyPreview.hidden = true;
    replyAuthor.textContent = "";
    replyText.textContent = "";
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
    if ((!text && !selectedImageData) || !currentRoom) return;
    const sendButton = messageForm.querySelector("button[type='submit']");
    sendButton.disabled = true;
    socket.emit("send-message", { text, imageData: selectedImageData, replyToId: currentReplyTo }, (result) => {
      sendButton.disabled = false;
      if (!result?.ok) {
        chatNotice.textContent = result?.error || "No se pudo enviar. Inténtalo otra vez.";
        chatNotice.classList.add("offline");
        return;
      }
      messageInput.value = "";
      clearSelectedImage();
      clearReply();
      messageInput.focus();
    });
  });

  function clearSelectedImage() {
    selectedImageData = "";
    imageInput.value = "";
    previewImage.removeAttribute("src");
    imagePreview.hidden = true;
  }

  document.querySelector("#choose-image").addEventListener("click", () => imageInput.click());
  document.querySelector("#remove-image").addEventListener("click", clearSelectedImage);
  document.querySelector("#cancel-reply").addEventListener("click", clearReply);
  imageInput.addEventListener("change", async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      chatNotice.textContent = "Elige una imagen JPG, PNG o WEBP.";
      chatNotice.classList.add("offline");
      clearSelectedImage();
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      chatNotice.textContent = "La imagen original es muy grande. Elige una de menos de 12 MB.";
      chatNotice.classList.add("offline");
      clearSelectedImage();
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      let scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      let compressed;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        compressed = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.76));
        if (compressed && compressed.size <= 1_000_000) break;
        scale *= 0.78;
      }
      bitmap.close();
      if (!compressed || compressed.size > 1_000_000) {
        chatNotice.textContent = "No pude reducir esa imagen lo suficiente. Prueba con otra.";
        chatNotice.classList.add("offline");
        clearSelectedImage();
        return;
      }
      selectedImageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
        reader.readAsDataURL(compressed);
      });
      previewImage.src = selectedImageData;
      imagePreview.hidden = false;
      chatNotice.textContent = "La imagen es temporal y desaparecerá al reiniciarse el servidor.";
      chatNotice.classList.remove("offline");
    } catch {
      chatNotice.textContent = "No pude abrir esa imagen. Prueba con otra.";
      chatNotice.classList.add("offline");
      clearSelectedImage();
    }
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
    chatNotice.textContent = "Las imágenes y mensajes son temporales; se borran cuando se reinicia el servidor.";
    chatNotice.classList.remove("offline");
  });
  socket.on("disconnect", () => {
    chatNotice.textContent = "Se perdió la conexión. Intentando reconectar…";
    chatNotice.classList.add("offline");
  });

  document.querySelector("#leave").addEventListener("click", () => {
    currentRoom = "";
    currentUsername = "";
    clearReply();
    clearSelectedImage();
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
