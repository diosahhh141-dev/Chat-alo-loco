const path = require("node:path");
const express = require("express");
const { createServer } = require("node:http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  // Permite usar WebSocket y también la reconexión automática de Socket.IO.
  maxHttpBufferSize: 10_000
});

const PORT = process.env.PORT || 3000;
const MAX_MESSAGES_PER_ROOM = 100;
const roomMessages = new Map();

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

  socket.on("send-message", (rawMessage) => {
    const room = socket.data.room;
    const username = socket.data.username;
    if (!room || !username) return;

    const now = Date.now();
    if (now - (socket.data.lastMessageAt || 0) < 500) return;
    socket.data.lastMessageAt = now;

    const text = cleanText(rawMessage, 500);
    if (!text) return;

    const message = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      username,
      text,
      time: new Date(now).toISOString()
    };
    const messages = roomMessages.get(room) || [];
    messages.push(message);
    if (messages.length > MAX_MESSAGES_PER_ROOM) messages.shift();
    roomMessages.set(room, messages);
    io.to(room).emit("message", message);
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
