const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { createServer } = require("node:http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  // Mensajes con una imagen JPEG comprimida, sin aceptar cargas enormes.
  maxHttpBufferSize: 1_500_000
});

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
const MAX_MESSAGES_PER_ROOM = 100;
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_STORED_IMAGES = 32;
const roomMessages = new Map();
const storedImages = new Map();
const roomControls = new Map();

function getRoomControls(room) {
  if (!roomControls.has(room)) {
    roomControls.set(room, {
      adminKeyHash: "",
      creatorUsername: "",
      admins: new Set(),
      adminNames: new Set(),
      bannedUsers: new Set(),
      mutedUsers: new Set(),
      adminOnly: false,
      announcement: ""
    });
  }
  return roomControls.get(room);
}

function keyHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function publicRoomSettings(controls) {
  return { adminOnly: controls.adminOnly, announcement: controls.announcement };
}

function emitRoomSettings(room, controls) {
  io.to(room).emit("room-settings", publicRoomSettings(controls));
}

function removeRoomImages(messages = []) {
  for (const message of messages) storedImages.delete(message.id);
}

app.use(express.static(path.join(__dirname, "public")));
app.get("/config.js", (_req, res) => {
  res.type("application/javascript").send(`window.APP_CONFIG = ${JSON.stringify({
    supabaseEnabled: SUPABASE_ENABLED,
    supabaseUrl: SUPABASE_ENABLED ? SUPABASE_URL : "",
    supabaseAnonKey: SUPABASE_ENABLED ? SUPABASE_ANON_KEY : ""
  })};`);
});
app.get("/health", (_req, res) => res.json({ ok: true }));

async function supabaseRest(resource, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${body.slice(0, 250)}`);
  return body ? JSON.parse(body) : null;
}

async function saveRoomSettings(room, controls) {
  if (!SUPABASE_ENABLED) return;
  await supabaseRest(`rooms?code=eq.${encodeURIComponent(room)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ admin_only: controls.adminOnly, announcement: controls.announcement })
  });
}

async function findAccountIdsByUsername(username) {
  if (!SUPABASE_ENABLED) return [];
  const profiles = await supabaseRest("profiles?select=id,username");
  const wanted = username.toLocaleLowerCase("es");
  return (profiles || []).filter((profile) => profile.username?.toLocaleLowerCase("es") === wanted).map((profile) => profile.id);
}

async function verifySupabaseToken(token) {
  if (!SUPABASE_ENABLED || typeof token !== "string" || !token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  return response.ok ? response.json() : null;
}

async function supabaseUserRest(token, resource, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(body.slice(0, 250));
  return body ? JSON.parse(body) : null;
}

async function cleanExpiredStories() {
  if (!SUPABASE_ENABLED) return;
  try {
    const expired = await supabaseRest(`stories?expires_at=lt.${encodeURIComponent(new Date().toISOString())}&select=id,media_path`);
    if (!expired?.length) return;
    const paths = expired.map((story) => story.media_path);
    await fetch(`${SUPABASE_URL}/storage/v1/object/media`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prefixes: paths })
    });
    const ids = expired.map((story) => story.id);
    await supabaseRest(`stories?id=in.(${ids.map(encodeURIComponent).join(",")})`, { method: "DELETE" });
  } catch (error) {
    console.error("No se pudieron limpiar historias vencidas:", error.message);
  }
}

if (SUPABASE_ENABLED) {
  io.use(async (socket, next) => {
    try {
      const user = await verifySupabaseToken(socket.handshake.auth?.token);
      if (!user?.id) return next(new Error("Inicia sesión para conectar con el chat."));
      const profiles = await supabaseRest(`profiles?id=eq.${encodeURIComponent(user.id)}&select=username`);
      if (!profiles?.[0]) return next(new Error("No encontré tu perfil."));
      socket.data.authUser = user;
      socket.data.profile = profiles[0];
      socket.data.accessToken = socket.handshake.auth.token;
      next();
    } catch {
      next(new Error("No se pudo verificar tu cuenta."));
    }
  });
  cleanExpiredStories();
  setInterval(cleanExpiredStories, 60 * 60 * 1000).unref();
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function validRoom(value) {
  const room = cleanText(value, 24).toUpperCase();
  return /^[A-Z0-9_-]{3,24}$/.test(room) ? room : "";
}

function readImageData(value) {
  if (typeof value !== "string") return null;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== match[1]) return null;
  return value;
}

function expireOldestImage() {
  const oldest = storedImages.entries().next().value;
  if (!oldest) return;
  const [id, message] = oldest;
  message.imageData = null;
  message.imageExpired = true;
  storedImages.delete(id);
}

io.on("connection", (socket) => {
  socket.on("join-room", async ({ room: rawRoom, username: rawUsername, adminKey: rawAdminKey } = {}, reply = () => {}) => {
    const room = validRoom(rawRoom);
    let username = cleanText(rawUsername, 24);

    if (!room || username.length < 1) {
      reply({ ok: false, error: "Escribe un nombre y un código de sala válido (3 a 24 letras o números)." });
      return;
    }

    if (SUPABASE_ENABLED) {
      const userId = socket.data.authUser?.id;
      if (!userId) {
        reply({ ok: false, error: "Inicia sesión para entrar a una sala." });
        return;
      }
      try {
        const memberships = await supabaseRest(`room_members?room_code=eq.${encodeURIComponent(room)}&user_id=eq.${encodeURIComponent(userId)}&select=user_id`);
        if (!memberships?.length) {
          reply({ ok: false, error: "Escribe la contraseña de la sala para entrar." });
          return;
        }
        const bans = await supabaseRest(`room_bans?room_code=eq.${encodeURIComponent(room)}&user_id=eq.${encodeURIComponent(userId)}&select=user_id`);
        if (bans?.length) {
          reply({ ok: false, error: "Tu cuenta está bloqueada en esta sala." });
          return;
        }
        username = socket.data.profile.username;
      } catch {
        reply({ ok: false, error: "No pude verificar tu acceso a la sala." });
        return;
      }
    }

    const controls = getRoomControls(room);
    const normalizedName = username.toLocaleLowerCase("es");
    let creator = false;
    let admin = false;
    let adminKeyError = false;
    if (SUPABASE_ENABLED) {
      try {
        const rooms = await supabaseRest(`rooms?code=eq.${encodeURIComponent(room)}&select=created_by,admin_only,announcement`);
        creator = rooms?.[0]?.created_by === socket.data.authUser?.id;
        controls.adminOnly = Boolean(rooms?.[0]?.admin_only);
        controls.announcement = cleanText(rooms?.[0]?.announcement, 180);
        if (creator) {
          controls.creatorUsername = normalizedName;
          controls.adminNames.add(normalizedName);
        }
        const adminRows = await supabaseRest(`room_admins?room_code=eq.${encodeURIComponent(room)}&user_id=eq.${encodeURIComponent(socket.data.authUser.id)}&select=user_id`);
        const isStoredAdmin = creator || Boolean(adminRows?.length);
        const adminKey = typeof rawAdminKey === "string" ? rawAdminKey.trim() : "";
        if (adminKey) {
          if (adminKey.length >= 8) {
            const result = await supabaseRest("rpc/authorize_room_admin", {
              method: "POST",
              body: JSON.stringify({ p_code: room, p_key: adminKey, p_user_id: socket.data.authUser.id })
            });
            if (result?.authorized) {
              controls.adminKeyHash = "supabase";
              controls.adminNames.add(normalizedName);
              admin = true;
            } else {
              adminKeyError = true;
            }
          } else {
            adminKeyError = true;
          }
        } else {
          admin = isStoredAdmin;
        }
        if (admin) controls.adminNames.add(normalizedName);
      } catch {
        reply({ ok: false, error: "No pude cargar los permisos de esa sala." });
        return;
      }
    }
    if (controls.bannedUsers.has(normalizedName)) {
      reply({ ok: false, error: "Este nombre está bloqueado en esta sala." });
      return;
    }

    admin = SUPABASE_ENABLED ? (admin || creator) : creator;
    const adminKey = typeof rawAdminKey === "string" ? rawAdminKey.trim() : "";
    if (!SUPABASE_ENABLED && adminKey) {
      if (adminKey.length < 8) {
        adminKeyError = true;
      } else if (!controls.adminKeyHash) {
        controls.adminKeyHash = keyHash(adminKey);
        controls.creatorUsername = normalizedName;
        admin = true;
        creator = true;
      } else if (controls.adminKeyHash === keyHash(adminKey)) {
        admin = true;
        creator = normalizedName === controls.creatorUsername;
      } else {
        adminKeyError = true;
      }
    }

    if (socket.data.room) {
      getRoomControls(socket.data.room).admins.delete(socket.id);
      socket.leave(socket.data.room);
    }
    if (admin) {
      controls.admins.add(socket.id);
      controls.adminNames.add(normalizedName);
    }
    socket.data.room = room;
    socket.data.username = username;
    socket.data.lastMessageAt = 0;
    socket.join(room);

    let messages = roomMessages.get(room) || [];
    if (SUPABASE_ENABLED) {
      try {
        const rows = await supabaseRest(`chat_messages?room_code=eq.${encodeURIComponent(room)}&select=*&order=created_at.desc&limit=${MAX_MESSAGES_PER_ROOM}`);
        rows.reverse();
        const byId = new Map(rows.map((row) => [row.id, row]));
        messages = rows.map((row) => {
          const quoted = byId.get(row.reply_to_id);
          return {
            id: row.id,
            username: row.username,
            isAdmin: Boolean(row.is_admin || row.is_creator),
            isCreator: row.is_creator,
            text: row.body,
            imageData: row.image_data,
            replyTo: quoted ? { id: quoted.id, username: quoted.username, text: cleanText(quoted.body, 120), hasImage: Boolean(quoted.image_data) } : null,
            time: row.created_at
          };
        });
        roomMessages.set(room, messages);
      } catch {
        reply({ ok: false, error: "No pude cargar el historial de esta sala." });
        return;
      }
    }
    reply({ ok: true, room, messages, admin, creator, adminKeyError, settings: publicRoomSettings(controls) });
    socket.to(room).emit("notice", `${username} se unió al chat.`);
  });

  socket.on("send-message", async (payload, reply = () => {}) => {
    const room = socket.data.room;
    const username = socket.data.username;
    if (!room || !username) {
      reply({ ok: false, error: "Entra a una sala antes de enviar mensajes." });
      return;
    }
    const controls = getRoomControls(room);
    const isAdmin = controls.admins.has(socket.id);
    const isCreator = isAdmin && username.toLocaleLowerCase("es") === controls.creatorUsername;
    const normalizedName = username.toLocaleLowerCase("es");
    if (controls.bannedUsers.has(normalizedName)) {
      reply({ ok: false, error: "Tu nombre está bloqueado en esta sala." });
      socket.emit("moderation-kick", "Tu nombre está bloqueado en esta sala.");
      socket.leave(room);
      socket.data.room = "";
      return;
    }
    if (controls.mutedUsers.has(normalizedName) && !isAdmin) {
      reply({ ok: false, error: "Un administrador silenció tu nombre en esta sala." });
      return;
    }
    if (controls.adminOnly && !isAdmin) {
      reply({ ok: false, error: "La sala está en modo solo administradores." });
      return;
    }

    const now = Date.now();
    if (now - (socket.data.lastMessageAt || 0) < 500) {
      reply({ ok: false, error: "Espera un momento antes de enviar otro mensaje." });
      return;
    }
    socket.data.lastMessageAt = now;

    const text = cleanText(payload?.text, 500);
    const imageData = readImageData(payload?.imageData);
    if (payload?.imageData && !imageData) {
      reply({ ok: false, error: "No se pudo enviar la imagen. Prueba con otra más pequeña." });
      return;
    }
    if (!text && !imageData) {
      reply({ ok: false, error: "Escribe un mensaje o selecciona una imagen." });
      return;
    }

    while (imageData && storedImages.size >= MAX_STORED_IMAGES) expireOldestImage();

    const messages = roomMessages.get(room) || [];
    const original = typeof payload?.replyToId === "string"
      ? messages.find((item) => item.id === payload.replyToId)
      : null;
    const replyTo = original ? {
      id: original.id,
      username: cleanText(original.username, 24),
      text: cleanText(original.text, 120),
      hasImage: Boolean(original.imageData || original.imageExpired)
    } : null;

    const message = {
      id: typeof payload?.id === "string" && /^[0-9a-f-]{36}$/i.test(payload.id) ? payload.id : crypto.randomUUID(),
      username,
      isAdmin,
      isCreator,
      text,
      imageData,
      replyTo,
      time: new Date(now).toISOString()
    };
    if (SUPABASE_ENABLED) {
      try {
        const saved = await supabaseUserRest(socket.data.accessToken, "chat_messages", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            id: message.id,
            room_code: room,
            body: text,
            image_data: imageData,
            reply_to_id: original?.id || null
          })
        });
        if (!saved?.[0]) throw new Error("No se guardó el mensaje.");
        message.username = saved[0].username;
        message.isCreator = saved[0].is_creator;
        message.isAdmin = saved[0].is_admin;
        message.time = saved[0].created_at;
      } catch (error) {
        reply({ ok: false, error: /can_send_room_message|row-level security/i.test(error.message) ? "No tienes permiso para escribir: puede que la sala esté en modo solo administradores o tengas un silencio/bloqueo." : "No se pudo guardar el mensaje. Comprueba tu acceso y vuelve a intentarlo." });
        return;
      }
    }
    messages.push(message);
    if (messages.length > MAX_MESSAGES_PER_ROOM) {
      const removed = messages.shift();
      if (removed?.imageData) storedImages.delete(removed.id);
    }
    roomMessages.set(room, messages);
    if (imageData) storedImages.set(message.id, message);
    io.to(room).emit("message", message);
    reply({ ok: true });
  });

  socket.on("admin-command", async ({ command: rawCommand } = {}, reply = () => {}) => {
    const room = socket.data.room;
    const username = socket.data.username;
    const command = cleanText(rawCommand, 600);
    if (!room || !username || !command.startsWith("/")) {
      reply({ ok: false, message: "No pude leer ese comando." });
      return;
    }
    const [rawName = "", ...args] = command.slice(1).split(/\s+/);
    const name = rawName.toLocaleLowerCase("es");
    const controls = getRoomControls(room);
    const isAdmin = controls.admins.has(socket.id);
    const targetName = cleanText(args.join(" "), 24);
    const normalizedTarget = targetName.toLocaleLowerCase("es");
    const findMembers = async () => io.in(room).fetchSockets();
    const kickNamedMember = async (target, reason) => {
      const members = await findMembers();
      let count = 0;
      for (const member of members) {
        if (member.id !== socket.id && member.data.username?.toLocaleLowerCase("es") === target && !controls.admins.has(member.id)) {
          member.emit("moderation-kick", reason);
          member.leave(room);
          member.data.room = "";
          count += 1;
        }
      }
      return count;
    };

    if (name === "ayuda" || name === "help") {
      reply({ ok: true, message: "COMANDOS: /silenceadmin (o /sinlenceadmin) solo deja hablar a admins; /todos abre el chat; /ban NOMBRE bloquea; /desban NOMBRE desbloquea; /expulsar NOMBRE saca a una persona; /silenciar NOMBRE y /desilenciar NOMBRE controlan quién puede escribir; /anuncio TEXTO y /quitaranuncio fijan o quitan un aviso; /borrarultimo elimina el mensaje más reciente; /limpiarsala borra el historial; /cerrarsala cierra la sala. Para borrar un mensaje específico, usa el botón Borrar. La clave privada se comparte solo con coadmins." });
      return;
    }
    if (!isAdmin) {
      reply({ ok: false, message: "Solo los administradores pueden usar ese comando. Escribe /ayuda para ver los comandos." });
      return;
    }

    if (["silenceadmin", "sinlenceadmin", "soloadmins"].includes(name)) {
      controls.adminOnly = true;
      await saveRoomSettings(room, controls);
      emitRoomSettings(room, controls);
      reply({ ok: true, message: "Modo solo administradores activado." });
    } else if (["todos", "salapublica"].includes(name)) {
      controls.adminOnly = false;
      await saveRoomSettings(room, controls);
      emitRoomSettings(room, controls);
      reply({ ok: true, message: "Todos pueden volver a escribir." });
    } else if (name === "ban" && targetName) {
      if (controls.adminNames.has(normalizedTarget)) {
        reply({ ok: false, message: "No puedes bloquear a un administrador." });
        return;
      }
      controls.bannedUsers.add(normalizedTarget);
      if (SUPABASE_ENABLED) {
        const ids = await findAccountIdsByUsername(targetName);
        for (const userId of ids) await supabaseRest("room_bans", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ room_code: room, user_id: userId }) });
      }
      const count = await kickNamedMember(normalizedTarget, "Tu nombre fue bloqueado por un administrador.");
      reply({ ok: true, message: `${targetName} quedó bloqueado${count ? " y salió de la sala" : ""}.` });
    } else if (name === "desban" && targetName) {
      controls.bannedUsers.delete(normalizedTarget);
      if (SUPABASE_ENABLED) {
        const ids = await findAccountIdsByUsername(targetName);
        for (const userId of ids) await supabaseRest(`room_bans?room_code=eq.${encodeURIComponent(room)}&user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" });
      }
      reply({ ok: true, message: `Se quitó el bloqueo de ${targetName}.` });
    } else if (name === "expulsar" && targetName) {
      const count = await kickNamedMember(normalizedTarget, "Un administrador te sacó de la sala.");
      reply({ ok: count > 0, message: count ? `${targetName} salió de la sala.` : `No encontré a ${targetName} como miembro no administrador.` });
    } else if (name === "silenciar" && targetName) {
      controls.mutedUsers.add(normalizedTarget);
      if (SUPABASE_ENABLED) {
        const ids = await findAccountIdsByUsername(targetName);
        for (const userId of ids) await supabaseRest("room_mutes", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ room_code: room, user_id: userId }) });
      }
      reply({ ok: true, message: `${targetName} ya no puede enviar mensajes.` });
    } else if (name === "desilenciar" && targetName) {
      controls.mutedUsers.delete(normalizedTarget);
      if (SUPABASE_ENABLED) {
        const ids = await findAccountIdsByUsername(targetName);
        for (const userId of ids) await supabaseRest(`room_mutes?room_code=eq.${encodeURIComponent(room)}&user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" });
      }
      reply({ ok: true, message: `${targetName} puede volver a escribir.` });
    } else if (name === "anuncio" && args.length) {
      controls.announcement = cleanText(args.join(" "), 180);
      await saveRoomSettings(room, controls);
      emitRoomSettings(room, controls);
      reply({ ok: true, message: "Anuncio fijado para la sala." });
    } else if (name === "quitaranuncio") {
      controls.announcement = "";
      await saveRoomSettings(room, controls);
      emitRoomSettings(room, controls);
      reply({ ok: true, message: "Se quitó el anuncio." });
    } else if (name === "borrarultimo") {
      const messages = roomMessages.get(room) || [];
      const removed = messages.pop();
      if (removed?.imageData) storedImages.delete(removed.id);
      if (SUPABASE_ENABLED && removed) await supabaseRest(`chat_messages?id=eq.${encodeURIComponent(removed.id)}&room_code=eq.${encodeURIComponent(room)}`, { method: "DELETE" });
      io.to(room).emit("message-deleted", removed?.id || "");
      reply({ ok: true, message: removed ? "Se borró el mensaje más reciente." : "No hay mensajes que borrar." });
    } else if (name === "borrarmensaje" && args[0]) {
      const messages = roomMessages.get(room) || [];
      const index = messages.findIndex((item) => item.id === args[0]);
      const [removed] = index >= 0 ? messages.splice(index, 1) : [];
      if (removed?.imageData) storedImages.delete(removed.id);
      if (SUPABASE_ENABLED && removed) await supabaseRest(`chat_messages?id=eq.${encodeURIComponent(removed.id)}&room_code=eq.${encodeURIComponent(room)}`, { method: "DELETE" });
      io.to(room).emit("message-deleted", removed?.id || "");
      reply({ ok: Boolean(removed), message: removed ? "Mensaje borrado." : "No encontré ese mensaje." });
    } else if (name === "limpiarsala") {
      const messages = roomMessages.get(room) || [];
      removeRoomImages(messages);
      roomMessages.set(room, []);
      if (SUPABASE_ENABLED) await supabaseRest(`chat_messages?room_code=eq.${encodeURIComponent(room)}`, { method: "DELETE" });
      io.to(room).emit("room-cleared");
      reply({ ok: true, message: "Se borró todo el historial de esta sala." });
    } else if (name === "cerrarsala") {
      const members = await findMembers();
      for (const member of members) {
        member.emit("room-closed", "Un administrador cerró esta sala.");
        member.leave(room);
        member.data.room = "";
        roomControls.delete(room);
      }
      removeRoomImages(roomMessages.get(room) || []);
      roomMessages.delete(room);
      if (SUPABASE_ENABLED) await supabaseRest(`rooms?code=eq.${encodeURIComponent(room)}`, { method: "DELETE" });
      reply({ ok: true, message: "Sala cerrada." });
    } else {
      reply({ ok: false, message: "Comando desconocido o incompleto. Escribe /ayuda." });
    }
  });

  socket.on("disconnect", () => {
    if (socket.data.room) getRoomControls(socket.data.room).admins.delete(socket.id);
    if (socket.data.room && socket.data.username) {
      socket.to(socket.data.room).emit("notice", `${socket.data.username} salió del chat.`);
    }
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Chat listo en el puerto ${PORT}`);
});
