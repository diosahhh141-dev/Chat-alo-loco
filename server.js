const path = require("node:path");
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
  socket.on("join-room", ({ room: rawRoom, username: rawUsername } = {}, reply = () => {}) => {
    const room = validRoom(rawRoom);
    const username = cleanText(rawUsername, 24);

    if (!room || username.length < 1) {
      reply({ ok: false, error: "Escribe un nombre y un código de sala válido (3 a 24 letras o números)." });
      return;
    }

    if (socket.data.room) socket.leave(socket.data.room);
    socket.data.room = room;
    socket.data.username = username;
    socket.data.lastMessageAt = 0;
    socket.join(room);

    const messages = roomMessages.get(room) || [];
    reply({ ok: true, room, messages });
    socket.to(room).emit("notice", `${username} se unió al chat.`);
  });

  socket.on("send-message", (payload, reply = () => {}) => {
    const room = socket.data.room;
    const username = socket.data.username;
    if (!room || !username) {
      reply({ ok: false, error: "Entra a una sala antes de enviar mensajes." });
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

    const message = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      username,
      text,
      imageData,
      time: new Date(now).toISOString()
    };
    const messages = roomMessages.get(room) || [];
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

  socket.on("disconnect", () => {
    if (socket.data.room && socket.data.username) {
      socket.to(socket.data.room).emit("notice", `${socket.data.username} salió del chat.`);
    }
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Chat listo en el puerto ${PORT}`);
});
