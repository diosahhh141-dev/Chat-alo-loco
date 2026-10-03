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
app.get("/health", (_req, res) => res.json({ ok: true }));

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
  socket.on("join-room", ({ room: rawRoom, username: rawUsername, adminKey: rawAdminKey } = {}, reply = () => {}) => {
    const room = validRoom(rawRoom);
    const username = cleanText(rawUsername, 24);

    if (!room || username.length < 1) {
      reply({ ok: false, error: "Escribe un nombre y un código de sala válido (3 a 24 letras o números)." });
      return;
    }

    const controls = getRoomControls(room);
    const normalizedName = username.toLocaleLowerCase("es");
    if (controls.bannedUsers.has(normalizedName)) {
      reply({ ok: false, error: "Este nombre está bloqueado en esta sala." });
      return;
    }

    const adminKey = typeof rawAdminKey === "string" ? rawAdminKey.trim() : "";
    let admin = false;
    let creator = false;
    let adminKeyError = false;
    if (adminKey) {
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

    const messages = roomMessages.get(room) || [];
    reply({ ok: true, room, messages, admin, creator, adminKeyError, settings: publicRoomSettings(controls) });
    socket.to(room).emit("notice", `${username} se unió al chat.`);
  });

  socket.on("send-message", (payload, reply = () => {}) => {
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
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      username,
      isAdmin,
      isCreator,
      text,
      imageData,
      replyTo,
      time: new Date(now).toISOString()
    };
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
      emitRoomSettings(room, controls);
      reply({ ok: true, message: "Modo solo administradores activado." });
    } else if (["todos", "salapublica"].includes(name)) {
      controls.adminOnly = false;
      emitRoomSettings(room, controls);
      reply({ ok: true, message: "Todos pueden volver a escribir." });
    } else if (name === "ban" && targetName) {
      if (controls.adminNames.has(normalizedTarget)) {
        reply({ ok: false, message: "No puedes bloquear a un administrador." });
        return;
      }
      controls.bannedUsers.add(normalizedTarget);
      const count = await kickNamedMember(normalizedTarget, "Tu nombre fue bloqueado por un administrador.");
      reply({ ok: true, message: `${targetName} quedó bloqueado${count ? " y salió de la sala" : ""}.` });
    } else if (name === "desban" && targetName) {
      controls.bannedUsers.delete(normalizedTarget);
      reply({ ok: true, message: `Se quitó el bloqueo de ${targetName}.` });
    } else if (name === "expulsar" && targetName) {
      const count = await kickNamedMember(normalizedTarget, "Un administrador te sacó de la sala.");
      reply({ ok: count > 0, message: count ? `${targetName} salió de la sala.` : `No encontré a ${targetName} como miembro no administrador.` });
    } else if (name === "silenciar" && targetName) {
      controls.mutedUsers.add(normalizedTarget);
      reply({ ok: true, message: `${targetName} ya no puede enviar mensajes.` });
    } else if (name === "desilenciar" && targetName) {
      controls.mutedUsers.delete(normalizedTarget);
      reply({ ok: true, message: `${targetName} puede volver a escribir.` });
    } else if (name === "anuncio" && args.length) {
      controls.announcement = cleanText(args.join(" "), 180);
      emitRoomSettings(room, controls);
      reply({ ok: true, message: "Anuncio fijado para la sala." });
    } else if (name === "quitaranuncio") {
      controls.announcement = "";
      emitRoomSettings(room, controls);
      reply({ ok: true, message: "Se quitó el anuncio." });
    } else if (name === "borrarultimo") {
      const messages = roomMessages.get(room) || [];
      const removed = messages.pop();
      if (removed?.imageData) storedImages.delete(removed.id);
      io.to(room).emit("message-deleted", removed?.id || "");
      reply({ ok: true, message: removed ? "Se borró el mensaje más reciente." : "No hay mensajes que borrar." });
    } else if (name === "borrarmensaje" && args[0]) {
      const messages = roomMessages.get(room) || [];
      const index = messages.findIndex((item) => item.id === args[0]);
      const [removed] = index >= 0 ? messages.splice(index, 1) : [];
      if (removed?.imageData) storedImages.delete(removed.id);
      io.to(room).emit("message-deleted", removed?.id || "");
      reply({ ok: Boolean(removed), message: removed ? "Mensaje borrado." : "No encontré ese mensaje." });
    } else if (name === "limpiarsala") {
      const messages = roomMessages.get(room) || [];
      removeRoomImages(messages);
      roomMessages.set(room, []);
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
