(() => {
  const appConfig = window.APP_CONFIG || {};
  const socialMode = Boolean(appConfig.supabaseEnabled && window.supabase?.createClient);
  const supabase = socialMode ? window.supabase.createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey) : null;
    if (socialMode) window.APP_SUPABASE_CLIENT = supabase;
  const socket = io({ autoConnect: !socialMode });
  const authPanel = document.querySelector("#auth-panel");
  const socialPanel = document.querySelector("#social-panel");
  const loginForm = document.querySelector("#login-form");
  const registerForm = document.querySelector("#register-form");
  const authStatus = document.querySelector("#auth-status");
  const profileStatus = document.querySelector("#profile-status");
  const storiesList = document.querySelector("#stories-list");
  const profilesList = document.querySelector("#profiles-list");
  const storyViewer = document.querySelector("#story-viewer");
  let currentAccount = null;
  let currentProfile = null;  let socialChannel = null;
  let storyGroups = [];
  let activeStoryGroup = 0;
  let activeStoryIndex = 0;
  let storyRenderToken = 0;
  const joinPanel = document.querySelector("#join-panel");
  const chatPanel = document.querySelector("#chat-panel");
  const joinForm = document.querySelector("#join-form");
  const messageForm = document.querySelector("#message-form");
  const messagesList = document.querySelector("#messages");
  const joinError = document.querySelector("#join-error");
  const roomInput = document.querySelector("#room");
  const roomPasswordInput = document.querySelector("#room-password");
  const usernameInput = document.querySelector("#username");
  const adminKeyInput = document.querySelector("#admin-key");
  const messageInput = document.querySelector("#message");
  const imageInput = document.querySelector("#image-file");
  const imagePreview = document.querySelector("#image-preview");
  const previewImage = document.querySelector("#preview-image");
  const replyPreview = document.querySelector("#reply-preview");
  const replyAuthor = document.querySelector("#reply-author");
  const replyText = document.querySelector("#reply-text");
  const chatNotice = document.querySelector("#chat-notice");
  const roomAnnouncement = document.querySelector("#room-announcement");
  let currentRoom = "";
  let currentUsername = "";
  let currentAdminKey = "";
  let isAdmin = false;
  let isCreator = false;
  let selectedImageData = "";
  let currentReplyTo = "";
  const seenIds = new Set();

  async function setSocialStatus(message, error = false) {
    const status = document.querySelector("#social-status");
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  function setAuthStatus(message, error = false) {
    authStatus.textContent = message;
    authStatus.classList.toggle("success", !error && Boolean(message));
  }

  function showSocialView(view) {
    document.querySelector("#social-home-view").hidden = view !== "home";
    document.querySelector("#social-profile-view").hidden = view !== "profile";
    document.querySelector("#social-home").classList.toggle("active", view === "home");
    document.querySelector("#social-profile").classList.toggle("active", view === "profile");
  }

  async function mediaUrl(path) {
    if (!path) return "";
    const { data, error } = await supabase.storage.from("media").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  function fileExtension(file) {
    return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" })[file.type] || "bin";
  }

  async function uploadMedia(file, folder) {
    if (!file || file.size > 50 * 1024 * 1024) throw new Error("El archivo debe pesar menos de 50 MB.");
    const allowed = folder === "avatars"
      ? ["image/jpeg", "image/png", "image/webp"]
      : ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"];
    if (!allowed.includes(file.type)) throw new Error("Elige una imagen JPG, PNG, WEBP o un video MP4/WEBM.");
    const path = `${currentAccount.id}/${folder}/${crypto.randomUUID()}.${fileExtension(file)}`;
    const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return path;
  }

  function avatarNode(path, name, className = "profile-avatar") {
    const node = document.createElement("div");
    node.className = className;
    node.textContent = (name || "✦").trim().slice(0, 1).toUpperCase();
    if (path) mediaUrl(path).then((url) => {
      const image = document.createElement("img");
      image.src = url;
      image.alt = `Foto de ${name}`;
      node.replaceChildren(image);
    }).catch(() => {});
    return node;
  }

  async function loadSocialHome() {
    if (!currentAccount) return;
    setSocialStatus("Cargando historias y perfiles…");
    const [storyResult, profileResult, notificationResult] = await Promise.all([
      supabase.from("stories").select("id,user_id,media_path,media_type,caption,created_at,expires_at").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,username,bio,avatar_path").order("username"),
      supabase.from("notifications").select("id,title,body,room_code,created_at,read_at").eq("user_id", currentAccount.id).is("read_at", null).order("created_at", { ascending: false }).limit(8)
    ]);
    if (storyResult.error || profileResult.error || notificationResult.error) {
      setSocialStatus("No pude cargar la comunidad. Revisa la conexión con Supabase.", true);
      return;
    }
    const people = new Map(profileResult.data.map((profile) => [profile.id, profile]));
    storiesList.replaceChildren();
    if (!storyResult.data.length) {
      const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Todavía no hay historias. ¡Comparte la primera!"; storiesList.append(empty);
    }
        const groupedStories = new Map();
    for (const story of storyResult.data) {
      if (!groupedStories.has(story.user_id)) groupedStories.set(story.user_id, { profile: people.get(story.user_id) || { username: "Amigo", avatar_path: "" }, stories: [] });
      groupedStories.get(story.user_id).stories.push(story);
    }
    storyGroups = Array.from(groupedStories.values());
    for (const group of storyGroups) group.stories.reverse();
    for (const [groupIndex, group] of storyGroups.entries()) {
      const profile = group.profile;
      const button = document.createElement("button"); button.type = "button"; button.className = "story-card";
      button.append(avatarNode(profile.avatar_path, profile.username, "story-avatar"));
      const label = document.createElement("span"); label.textContent = profile.username; button.append(label);
      if (group.stories.length > 1) { const count = document.createElement("span"); count.className = "story-count"; count.textContent = String(group.stories.length); count.setAttribute("aria-label", group.stories.length + " historias"); button.append(count); }
      button.addEventListener("click", () => openStoryGroup(groupIndex));
      storiesList.append(button);
    }
profilesList.replaceChildren();
    for (const profile of profileResult.data) {
      const card = document.createElement("article"); card.className = "person-card";
      card.append(avatarNode(profile.avatar_path, profile.username));
      const copy = document.createElement("div"); copy.className = "person-copy";
      const name = document.createElement("strong"); name.textContent = profile.username;
      const bio = document.createElement("p"); bio.textContent = profile.bio || "Aún no ha escrito una descripción.";
      copy.append(name, bio); card.append(copy); profilesList.append(card);
    }
    const notices = notificationResult.data;
    const unread = notices.length;
    document.querySelector("#enable-notifications").textContent = unread ? `♧ ${unread}` : "♧";
    const notificationBox = document.querySelector("#notifications-list");
    notificationBox.replaceChildren();
    if (unread) {
      const heading = document.createElement("h3"); heading.className = "notification-heading"; heading.textContent = "Avisos nuevos"; notificationBox.append(heading);
      for (const notification of notices) {
        const row = document.createElement("button"); row.type = "button"; row.className = "notification-item";
        const title = document.createElement("strong"); title.textContent = notification.title;
        const body = document.createElement("span"); body.textContent = notification.body;
        row.append(title, body);
        row.addEventListener("click", async () => {
          await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notification.id);
          if (notification.room_code) { roomInput.value = notification.room_code; document.querySelector("#room-password-row").hidden = false; openChat(); }
          else loadSocialHome();
        });
        notificationBox.append(row);
      }
    }
    setSocialStatus(`Hola, ${currentProfile.username}. Aquí está tu comunidad.`);
  }

  async function openStory(story, profile) {
    const groupIndex = storyGroups.findIndex((group) => group.stories.some((item) => item.id === story.id));
    if (groupIndex >= 0) openStoryGroup(groupIndex);
  }

  async function openStoryGroup(groupIndex, storyIndex = 0) {
    activeStoryGroup = groupIndex; activeStoryIndex = storyIndex; storyViewer.hidden = false; await showActiveStory();
  }

  async function showActiveStory() {
    const group = storyGroups[activeStoryGroup]; const story = group?.stories[activeStoryIndex];
    if (!group || !story) return;
    const token = ++storyRenderToken; const slot = document.querySelector("#story-media-slot");
    slot.querySelectorAll("video").forEach((video) => video.pause()); slot.replaceChildren();
    document.querySelector("#story-owner").textContent = group.profile.username;
    document.querySelector("#story-counter").textContent = String(activeStoryIndex + 1) + " de " + group.stories.length;
    document.querySelector("#story-caption-view").textContent = group.profile.username + (story.caption ? " · " + story.caption : "");
    const progress = document.querySelector("#story-progress");
    progress.replaceChildren(...group.stories.map((_, index) => { const segment = document.createElement("span"); segment.className = "story-progress-segment" + (index < activeStoryIndex ? " complete" : index === activeStoryIndex ? " current" : ""); return segment; }));
    try {
      const url = await mediaUrl(story.media_path); if (token !== storyRenderToken || storyViewer.hidden) return;
      const media = document.createElement(story.media_type === "video" ? "video" : "img"); media.src = url; media.className = "story-media";
      if (story.media_type === "video") { media.controls = true; media.autoplay = true; } else media.alt = "Historia de " + group.profile.username; slot.append(media);
    } catch { if (token === storyRenderToken) setSocialStatus("No pude abrir esa historia. Puede que ya haya vencido.", true); }
  }

  function moveStory(direction) {
    const group = storyGroups[activeStoryGroup]; if (!group) return; const nextIndex = activeStoryIndex + direction;
    if (nextIndex >= 0 && nextIndex < group.stories.length) { activeStoryIndex = nextIndex; showActiveStory(); }
    else if (direction > 0 && activeStoryGroup < storyGroups.length - 1) { activeStoryGroup += 1; activeStoryIndex = 0; showActiveStory(); }
    else if (direction < 0 && activeStoryGroup > 0) { activeStoryGroup -= 1; activeStoryIndex = storyGroups[activeStoryGroup].stories.length - 1; showActiveStory(); }
    else if (direction > 0) closeStory();
  }

  function closeStory() {
    storyRenderToken += 1; storyViewer.hidden = true; const slot = document.querySelector("#story-media-slot");
    slot.querySelectorAll("video").forEach((video) => video.pause()); slot.replaceChildren();
  }

  function openChat() {
    socialPanel.hidden = true;
    chatPanel.hidden = true;
    joinPanel.hidden = false;
    document.querySelector("#leave-join").hidden = false;
    document.querySelector("#home-from-chat").hidden = false;
    document.querySelector("#room-password-row").hidden = false;
  }

  async function loadMyProfile() {
    const { data, error } = await supabase.from("profiles").select("id,username,bio,avatar_path").eq("id", currentAccount.id).single();
    if (error) throw error;
    currentProfile = data;
    document.querySelector("#profile-name").value = data.username || "";
    document.querySelector("#profile-bio").value = data.bio || "";
    const previousAvatar = document.querySelector("#profile-avatar-large");
    const nextAvatar = avatarNode(data.avatar_path, data.username, "profile-avatar large");
    nextAvatar.id = "profile-avatar-large";
    previousAvatar.replaceWith(nextAvatar);
    await loadSocialHome();
  }

  async function applySession(session) {
    currentAccount = session?.user || null;
    if (!currentAccount) {
      socket.disconnect();
      if (socialChannel) { await supabase.removeChannel(socialChannel); socialChannel = null; }
      currentProfile = null;
      authPanel.hidden = false; socialPanel.hidden = true; joinPanel.hidden = true; chatPanel.hidden = true;
      return;
    }
    authPanel.hidden = true; socialPanel.hidden = false; joinPanel.hidden = true; chatPanel.hidden = true;
    socket.auth = { token: session.access_token };
    if (socket.connected) socket.disconnect();
    socket.connect();
    try { await loadMyProfile(); }
    catch (error) { setSocialStatus(error.message || "No pude cargar tu perfil.", true); }
    if (socialChannel) await supabase.removeChannel(socialChannel);
    socialChannel = supabase.channel(`social-notifications-${currentAccount.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${currentAccount.id}` }, (payload) => {
      if ("Notification" in window && document.hidden && Notification.permission === "granted") new Notification(payload.new.title, { body: payload.new.body });
      loadSocialHome();
    }).subscribe();
  }

  if (socialMode) {
    joinPanel.hidden = true;
    document.querySelector("#room-password-row").hidden = false;
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault(); setAuthStatus("Entrando…");
      const { data, error } = await supabase.auth.signInWithPassword({ email: document.querySelector("#login-email").value.trim(), password: document.querySelector("#login-password").value });
      if (error) { setAuthStatus(error.message, true); return; }
      setAuthStatus("Sesión iniciada.");
    });
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault(); setAuthStatus("Creando tu cuenta…");
      const username = document.querySelector("#register-name").value.trim().replace(/\s+/g, " ").slice(0, 24);
      const { data, error } = await supabase.auth.signUp({
        email: document.querySelector("#register-email").value.trim(),
        password: document.querySelector("#register-password").value,
        options: { data: { username } }
      });
      if (error) { setAuthStatus(error.message, true); return; }
      if (!data.session) { setAuthStatus("Cuenta creada. Revisa tu correo para confirmar y luego inicia sesión."); return; }
      setAuthStatus("Cuenta creada. Preparando tu perfil…");
    });
    document.querySelector("#show-register").addEventListener("click", () => { loginForm.hidden = true; registerForm.hidden = false; setAuthStatus(""); });
    document.querySelector("#show-login").addEventListener("click", () => { registerForm.hidden = true; loginForm.hidden = false; setAuthStatus(""); });
    supabase.auth.onAuthStateChange((_event, session) => { if (_event !== "INITIAL_SESSION") queueMicrotask(() => applySession(session)); });
    supabase.auth.getSession().then(({ data }) => applySession(data.session));

    document.querySelector("#social-home").addEventListener("click", () => { showSocialView("home"); loadSocialHome(); });
    document.querySelector("#social-profile").addEventListener("click", () => showSocialView("profile"));
    document.querySelector("#open-chat").addEventListener("click", openChat);
    document.querySelector("#home-from-chat").addEventListener("click", () => { currentRoom = ""; chatPanel.hidden = true; joinPanel.hidden = true; socialPanel.hidden = false; showSocialView("home"); loadSocialHome(); });
    document.querySelector("#sign-out").addEventListener("click", async () => { await supabase.auth.signOut(); });
    document.querySelector("#close-story").addEventListener("click", closeStory); document.querySelector("#story-prev").addEventListener("click", () => moveStory(-1)); document.querySelector("#story-next").addEventListener("click", () => moveStory(1)); document.addEventListener("keydown", (event) => { if (storyViewer.hidden) return; if (event.key === "ArrowRight") { event.preventDefault(); moveStory(1); } else if (event.key === "ArrowLeft") { event.preventDefault(); moveStory(-1); } else if (event.key === "Escape") closeStory(); });
    document.querySelector("#create-story-home").addEventListener("click", () => showSocialView("profile"));
    document.querySelector("#enable-notifications").addEventListener("click", async () => {
      if (!("Notification" in window)) { setSocialStatus("Este navegador no permite avisos.", true); return; }
      const permission = await Notification.requestPermission();
      setSocialStatus(permission === "granted" ? "Avisos activados en este navegador." : "No se activaron los avisos.", permission !== "granted");
    });
    document.querySelector("#profile-form").addEventListener("submit", async (event) => {
      event.preventDefault(); profileStatus.textContent = "Guardando…";
      try {
        const username = document.querySelector("#profile-name").value.trim().replace(/\s+/g, " ").slice(0, 24);
        const bio = document.querySelector("#profile-bio").value.trim().slice(0, 240);
        if (!username) throw new Error("Escribe un nombre para mostrar.");
        let avatar_path = currentProfile.avatar_path;
        const file = document.querySelector("#avatar-file").files?.[0];
        if (file) avatar_path = await uploadMedia(file, "avatars");
        const { error } = await supabase.from("profiles").update({ username, bio, avatar_path }).eq("id", currentAccount.id);
        if (error) throw error;
        if (file && currentProfile.avatar_path) await supabase.storage.from("media").remove([currentProfile.avatar_path]).catch(() => {});
        currentProfile = { ...currentProfile, username, bio, avatar_path };
        profileStatus.textContent = "Perfil guardado."; await loadSocialHome();
        if (socket.connected) { socket.disconnect(); socket.auth = { token: (await supabase.auth.getSession()).data.session.access_token }; socket.connect(); }
      } catch (error) { profileStatus.textContent = error.message || "No se pudo guardar el perfil."; }
    });
        document.querySelector("#story-form").addEventListener("submit", async (event) => {
      event.preventDefault(); profileStatus.textContent = "Publicando historia…";
      const uploadedPaths = [];
      try {
        const files = Array.from(document.querySelector("#story-file").files || []);
        if (!files.length) throw new Error("Elige al menos una foto o video.");
        if (files.length > 10) throw new Error("Puedes subir hasta 10 archivos en una sola vez.");
        const allowedTypes = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"];
        if (files.some((file) => !allowedTypes.includes(file.type))) throw new Error("Usa fotos JPG, PNG o WEBP, o videos MP4 o WEBM.");
        if (files.some((file) => file.size > 50 * 1024 * 1024)) throw new Error("Cada archivo debe pesar menos de 50 MB.");
        const caption = document.querySelector("#story-caption").value.trim(); const rows = [];
        for (const [index, file] of files.entries()) {
          profileStatus.textContent = "Subiendo historia " + (index + 1) + " de " + files.length + "…";
          const path = await uploadMedia(file, "stories"); uploadedPaths.push(path);
          rows.push({ user_id: currentAccount.id, media_path: path, media_type: file.type.startsWith("video/") ? "video" : "image", caption });
        }
        const { error } = await supabase.from("stories").insert(rows); if (error) throw error;
        event.currentTarget.reset(); profileStatus.textContent = files.length + (files.length === 1 ? " historia publicada" : " historias publicadas") + ". Desaparecerán en 24 horas."; await loadSocialHome();
      } catch (error) {
        if (uploadedPaths.length) await supabase.storage.from("media").remove(uploadedPaths).catch(() => {});
        profileStatus.textContent = error.message || "No se pudieron publicar las historias.";
      }
    });  } else {
    joinPanel.hidden = false;
  }

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
    if (message.isCreator || message.isAdmin) {
      const badge = document.createElement("span");
      badge.className = message.isCreator ? "admin-badge creator-badge" : "admin-badge";
      badge.textContent = message.isCreator ? "CREATOR" : "ADMIN";
      name.append(" ", badge);
    }
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
    if (isAdmin) {
      const deleteButton = document.createElement("button");
      deleteButton.className = "admin-delete-action";
      deleteButton.type = "button";
      deleteButton.textContent = "Borrar";
      deleteButton.setAttribute("aria-label", "Borrar este mensaje");
      deleteButton.addEventListener("click", () => {
        socket.emit("admin-command", { command: `/borrarmensaje ${message.id}` }, (result) => {
          if (result?.message) addNotice(result.message);
        });
      });
      bubble.append(deleteButton);
    }
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

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    joinError.textContent = "";
    currentUsername = socialMode ? currentProfile?.username || "" : usernameInput.value.trim().slice(0, 24);
    currentAdminKey = adminKeyInput.value.trim();
    const room = roomInput.value.trim().toUpperCase();
    if (socialMode) {
      if (!currentAccount || !currentProfile) {
        joinError.textContent = "Inicia sesión para entrar a una sala.";
        return;
      }
      const { error } = await supabase.rpc("enter_room", { p_code: room, p_password: roomPasswordInput.value });
      if (error) {
        joinError.textContent = error.message || "No se pudo verificar la contraseña de la sala.";
        return;
      }
      if (!socket.connected) {
        joinError.textContent = "Conectando de forma segura…";
        await new Promise((resolve) => socket.once("connect", resolve));
      }
    }
    socket.emit("join-room", { username: currentUsername, room, adminKey: currentAdminKey }, (result) => {
      if (!result?.ok) {
        joinError.textContent = result?.error || "No se pudo entrar. Inténtalo de nuevo.";
        return;
      }
      currentRoom = result.room;
      isAdmin = Boolean(result.admin);
      isCreator = Boolean(result.creator);
      document.querySelector("#room-title").textContent = currentRoom;
      roomInput.value = currentRoom;
      history.replaceState(null, "", `?sala=${encodeURIComponent(currentRoom)}`);
      messagesList.replaceChildren();
      seenIds.clear();
      joinPanel.hidden = true;
      document.querySelector("#leave-join").hidden = true;
      chatPanel.hidden = false;
      document.querySelector("#home-from-chat").hidden = !socialMode;
      updateRoomSettings(result.settings || { adminOnly: false, announcement: "" });
      result.messages.forEach(addMessage);
      if (!result.messages.length) addNotice("¡Sala lista! Comparte el código y saluda a tus amigos.");
      if (isAdmin) addNotice("Entraste como administrador. Escribe /ayuda para ver tus comandos.");
      else if (result.adminKeyError) addNotice("La clave no coincide con la de administrador; entraste como miembro.");
      messageInput.focus();
    });
  });

  messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    if ((!text && !selectedImageData) || !currentRoom) return;
    const sendButton = messageForm.querySelector("button[type='submit']");
    sendButton.disabled = true;
    if (text.startsWith("/") && !selectedImageData) {
      socket.emit("admin-command", { command: text }, (result) => {
        sendButton.disabled = false;
        if (result?.message) addNotice(result.message);
        messageInput.value = "";
        messageInput.focus();
      });
      return;
    }
    let messageId = "";
    if (socialMode) {
      messageId = crypto.randomUUID();
    }
    socket.emit("send-message", { id: messageId, text, imageData: selectedImageData, replyToId: currentReplyTo }, (result) => {
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
      chatNotice.textContent = socialMode ? "La imagen se guardará junto con el mensaje." : "La imagen es temporal y desaparecerá al reiniciarse el servidor.";
      chatNotice.classList.remove("offline");
    } catch {
      chatNotice.textContent = "No pude abrir esa imagen. Prueba con otra.";
      chatNotice.classList.add("offline");
      clearSelectedImage();
    }
  });

  socket.on("message", addMessage);
  socket.on("notice", addNotice);
  function updateRoomSettings(settings = {}) {
    roomAnnouncement.textContent = settings.announcement || (settings.adminOnly ? "🔒 Solo los administradores pueden escribir." : "");
    roomAnnouncement.hidden = !roomAnnouncement.textContent;
  }
  socket.on("room-settings", updateRoomSettings);
  socket.on("message-deleted", (id) => {
    if (!id) return;
    messagesList.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.remove();
    seenIds.delete(id);
  });
  socket.on("room-cleared", () => {
    messagesList.replaceChildren();
    seenIds.clear();
    addNotice("Un administrador borró el historial de la sala.");
  });
  function leaveModeratedRoom(message) {
    currentRoom = "";
    currentAdminKey = "";
    isAdmin = false;
    isCreator = false;
    clearReply();
    clearSelectedImage();
    roomAnnouncement.hidden = true;
    chatPanel.hidden = true;
    joinPanel.hidden = socialMode;
    socialPanel.hidden = !socialMode;
    if (socialMode) { showSocialView("home"); loadSocialHome(); }
    messagesList.replaceChildren();
    chatNotice.textContent = message;
  }
  socket.on("moderation-kick", leaveModeratedRoom);
  socket.on("room-closed", leaveModeratedRoom);
  socket.on("connect", () => {
    if (currentRoom) {
      socket.emit("join-room", { username: currentUsername, room: currentRoom, adminKey: currentAdminKey }, (result) => {
        if (result?.ok) {
          isAdmin = Boolean(result.admin);
          isCreator = Boolean(result.creator);
          updateRoomSettings(result.settings);
          messagesList.replaceChildren();
          seenIds.clear();
          result.messages.forEach(addMessage);
        }
      });
    }
    chatNotice.textContent = socialMode ? "Los mensajes quedan guardados en tu cuenta." : "Las imágenes y mensajes son temporales; se borran cuando se reinicia el servidor.";
    chatNotice.classList.remove("offline");
  });
  socket.on("disconnect", () => {
    chatNotice.textContent = "Se perdió la conexión. Intentando reconectar…";
    chatNotice.classList.add("offline");
  });

  document.querySelector("#leave").addEventListener("click", () => {
    currentRoom = "";
    currentUsername = "";
    currentAdminKey = "";
    isAdmin = false;
    isCreator = false;
    adminKeyInput.value = "";
    roomAnnouncement.hidden = true;
    clearReply();
    clearSelectedImage();
    history.replaceState(null, "", location.pathname);
    chatPanel.hidden = true;
    joinPanel.hidden = socialMode;
    socialPanel.hidden = !socialMode;
    document.querySelector("#leave-join").hidden = true;
    if (socialMode) { showSocialView("home"); loadSocialHome(); }
    messagesList.replaceChildren();
  });

  document.querySelector("#leave-join").addEventListener("click", () => { joinPanel.hidden = true; socialPanel.hidden = false; showSocialView("home"); });

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
