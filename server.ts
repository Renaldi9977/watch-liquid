import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import http from "http";
import { Server } from "socket.io";
import multer from "multer";
import fs from "fs";

// Create temp uploads directory if it doesn't exist
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Setup multer storage
const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const sanitizeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        const hasExt = sanitizeName.includes('.');
        cb(null, uniqueSuffix + "-" + (hasExt ? sanitizeName : sanitizeName + ".mp4"));
    }
});
const upload = multer({ storage });

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  // ✅ FIX: Tambahkan headers agar browser izinkan akses mic/camera
  app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=*, microphone=*, autoplay=*, encrypted-media=*");
    res.setHeader("Feature-Policy", "camera *; microphone *; autoplay *");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    next();
  });
  
  // Serve static uploads
  app.use("/uploads", express.static(uploadDir));
  
  app.post("/api/upload", upload.single("video"), (req, res) => {
      if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
      }
      res.json({ url: `/uploads/${req.file.filename}` });
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  const rooms: Record<string, {
    host: string;
    users: { id: string; name: string; avatar: string; frameStyle: string }[];
    videoState: {
      url: string;
      playing: boolean;
      time: number;
    };
  }> = {};

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", ({ roomId, user }) => {
      socket.join(roomId);
      if (!rooms[roomId]) {
        rooms[roomId] = {
          host: socket.id,
          users: [],
          videoState: { url: "", playing: false, time: 0 },
        };
      }
      const room = rooms[roomId];
      
      const existingUser = room.users.find(u => u.id === socket.id);
      if (!existingUser) {
          room.users.push({ ...user, id: socket.id });
      }

      socket.emit("room-state", room);
      socket.to(roomId).emit("user-joined", { ...user, id: socket.id });
    });

    socket.on("video-load", ({ roomId, url }) => {
      if (rooms[roomId]) {
        rooms[roomId].videoState.url = url;
        rooms[roomId].videoState.time = 0;
        rooms[roomId].videoState.playing = false;
        io.to(roomId).emit("video-load", { url });
      }
    });

    socket.on("video-play", ({ roomId, time }) => {
       if (rooms[roomId]) {
        rooms[roomId].videoState.playing = true;
        rooms[roomId].videoState.time = time;        socket.to(roomId).emit("video-play", { time });
       }
    });

    socket.on("video-pause", ({ roomId, time }) => {
      if (rooms[roomId]) {
        rooms[roomId].videoState.playing = false;
        rooms[roomId].videoState.time = time;
        socket.to(roomId).emit("video-pause", { time });
      }
    });

    socket.on("video-seek", ({ roomId, time }) => {
      if (rooms[roomId]) {
        rooms[roomId].videoState.time = time;
        socket.to(roomId).emit("video-seek", { time });
      }
    });

    socket.on("video-upload", ({ roomId, fileDetail }) => {
        if (rooms[roomId]) {
            rooms[roomId].videoState.url = "local-file";
            rooms[roomId].videoState.time = 0;
            rooms[roomId].videoState.playing = true;
            io.to(roomId).emit("video-upload", { fileDetail });
        }
    });

    socket.on("chat-message", ({ roomId, message }) => {
      socket.to(roomId).emit("chat-message", { ...message, id: Date.now() + Math.random().toString() });
    });

    socket.on("chat-reply", ({ roomId, message }) => {
      socket.to(roomId).emit("chat-reply", { ...message, id: Date.now() + Math.random().toString() });
    });

    socket.on("transfer-admin", ({ roomId, newAdminId }) => {
      if (rooms[roomId]) {
        rooms[roomId].host = newAdminId;
        io.to(roomId).emit("admin-changed", newAdminId);
        io.to(roomId).emit("host-changed", newAdminId);
      }
    });

    socket.on("sync-request", ({ roomId }) => {
        if (rooms[roomId]) {
             socket.emit("video-sync", rooms[roomId].videoState);
        }
    });
    // WebRTC signaling
    socket.on("webrtc-offer", ({ target, offer, callerId }) => {
        io.to(target).emit("webrtc-offer", { offer, callerId });
    });
    
    socket.on("webrtc-answer", ({ target, answer, answererId }) => {
        io.to(target).emit("webrtc-answer", { answer, answererId });
    });

    socket.on("webrtc-ice-candidate", ({ target, candidate, senderId }) => {
        io.to(target).emit("webrtc-ice-candidate", { candidate, senderId });
    });

    socket.on("user-speaking", ({ roomId, userId, isSpeaking }) => {
        socket.to(roomId).emit("speaking-state", { userId, isSpeaking });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      Object.keys(rooms).forEach((roomId) => {
        const room = rooms[roomId];
        const userIndex = room.users.findIndex((u) => u.id === socket.id);
        if (userIndex !== -1) {
          const user = room.users[userIndex];
          room.users.splice(userIndex, 1);
          if (room.host === socket.id) {
             if (room.users.length > 0) {
                 room.host = room.users[0].id;
                 io.to(roomId).emit("host-changed", room.host);
             } else {
                 delete rooms[roomId];
             }
          }
          socket.to(roomId).emit("user-left", socket.id);
        }
      });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port " + PORT);
  });
}

startServer();
