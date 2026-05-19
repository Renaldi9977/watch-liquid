import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import YouTube, { YouTubeProps } from "react-youtube";
import ReactPlayer from "react-player";
import { useSocket } from "../store/useSocket";
import { useStore } from "../store/useStore";
import {
  ArrowLeft,
  Copy,
  Mic,
  MicOff,
  Send,
  Users,
  Youtube,
  Upload,
  Reply,
  Crown,
  X,
  FolderOpen,
  UploadCloud,
  Smile,
  Image as ImageIcon,
  CheckCheck,
  SendHorizonal,
} from "lucide-react";
import { cn } from "../lib/utils";
import Peer from "simple-peer";
import { LocalVideoPlayer } from "../components/LocalVideoPlayer";

interface User {
  id: string;
  name: string;
  avatar: string;
  frameColor: string;
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  time: string;
  avatar?: string;
  frameColor?: string;
  replyTo?: { id: string; sender: string; text: string; imageUrl?: string };
  imageUrl?: string;
  isSticker?: boolean;
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const socketRef = useSocket(roomId);
  const profile = useStore((state) => state.profile);

  // State
  const [participants, setParticipants] = useState<User[]>([]);
  const [hostId, setHostId] = useState<string>("");
  const [isHost, setIsHost] = useState(false);

  // Video State
  const [videoUrl, setVideoUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [isValidUrl, setIsValidUrl] = useState<boolean | null>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const playerRef = useRef<any>(null);
  const isSyncing = useRef(false);

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Form state
  const [replyingTo, setReplyingTo] = useState<{
    id: string;
    sender: string;
    text: string;
    imageUrl?: string;
  } | null>(null);
  const [showStickers, setShowStickers] = useState(false);
  const [customStickers, setCustomStickers] = useState<string[]>([]);
  const [chatWallpaper, setChatWallpaper] = useState<string | null>(null);
  const [wallpaperOpacity, setWallpaperOpacity] = useState<number>(0.3);
  const [previewWallpaper, setPreviewWallpaper] = useState<string | null>(null);
  const [previewOpacity, setPreviewOpacity] = useState<number>(0.3);

  // Load stickers on mount
  useEffect(() => {
    const saved = localStorage.getItem("customStickers");
    if (saved) {
      try {
        setCustomStickers(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const saveSticker = (dataUrl: string) => {
    const newStickers = [...customStickers, dataUrl];
    setCustomStickers(newStickers);
    localStorage.setItem("customStickers", JSON.stringify(newStickers));
  };

  const removeSticker = (idx: number) => {
    const newStickers = customStickers.filter((_, i) => i !== idx);
    setCustomStickers(newStickers);
    localStorage.setItem("customStickers", JSON.stringify(newStickers));
  };

  const handleCreateSticker = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) saveSticker(ev.target.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleWallpaperUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setPreviewWallpaper(ev.target.result as string);
        setPreviewOpacity(wallpaperOpacity);
      }
    };
    reader.readAsDataURL(file);

    // Reset the input value so the same file can be uploaded again if needed
    e.target.value = "";
  };

  const applyWallpaper = () => {
    setChatWallpaper(previewWallpaper);
    setWallpaperOpacity(previewOpacity);
    setPreviewWallpaper(null);
  };

  const resetWallpaper = () => {
    setChatWallpaper(null);
    setPreviewWallpaper(null);
  };

  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(
    null,
  );

  // Audio/WebRTC State
  const [micEnabled, setMicEnabled] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Record<string, Peer.Instance>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});

  // Voice activity detection
  const [speakingUsers, setSpeakingUsers] = useState<Record<string, boolean>>(
    {},
  );
  const audioContextRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Record<string, AnalyserNode>>({});
  const dataArraysRef = useRef<Record<string, Uint8Array>>({});
  const checkAudioIntervalRef = useRef<any>(null);
  const speakingTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const localSpeakingStateRef = useRef<Record<string, boolean>>({});

  // layout responsive state
  // removed activeTab since we use combined layout on mobile

  useEffect(() => {
    if (!socketRef.current) return;
    const socket = socketRef.current;

    socket.on("room-state", (state) => {
      setParticipants(state.users);
      setHostId(state.host);
      if (state.host === socket.id) setIsHost(true);

      if (state.videoState.url) {
        setVideoUrl(state.videoState.url);
        setTimeout(() => {
          if (playerRef.current && playerRef.current.seekTo) {
            playerRef.current.seekTo(state.videoState.time, true);
            if (state.videoState.playing) {
              playerRef.current.playVideo();
            } else {
              playerRef.current.pauseVideo();
            }
          }
          setPlaying(state.videoState.playing);
        }, 1000); // Give it some time to load
      }
    });

    socket.on("user-joined", (user) => {
      setParticipants((prev) => {
        if (prev.find((p) => p.id === user.id)) return prev;
        return [...prev, user];
      });

      // Initiate WebRTC peer connection
      if (localStreamRef.current) {
        const peer = createPeer(user.id, socket.id, localStreamRef.current);
        peersRef.current[user.id] = peer;
      }
    });

    socket.on("user-left", (id) => {
      setParticipants((prev) => prev.filter((u) => u.id !== id));
      if (peersRef.current[id]) {
        peersRef.current[id].destroy();
        delete peersRef.current[id];
      }
      if (audioRefs.current[id]) {
        audioRefs.current[id].pause();
        audioRefs.current[id].srcObject = null;
        delete audioRefs.current[id];
      }
    });

    socket.on("host-changed", (newHostId) => {
      setHostId(newHostId);
      if (newHostId === socket.id) setIsHost(true);
    });

    socket.on("webrtc-offer", ({ offer, callerId }) => {
      if (!localStreamRef.current) return;
      const peer = addPeer(offer, callerId, localStreamRef.current);
      peersRef.current[callerId] = peer;
    });

    socket.on("webrtc-answer", ({ answer, answererId }) => {
      const peer = peersRef.current[answererId];
      if (peer) {
        peer.signal(answer);
      }
    });

    socket.on("webrtc-ice-candidate", ({ candidate, senderId }) => {
      const peer = peersRef.current[senderId];
      if (peer) {
        peer.signal(candidate);
      }
    });

    // Video Sync
    socket.on("video-load", ({ url }) => {
      setVideoUrl(url);
      setPlaying(false);
    });

    socket.on("video-play", ({ time }) => {
      isSyncing.current = true;
      setPlaying(true);
      if (playerRef.current && playerRef.current.getCurrentTime) {
        if (Math.abs((playerRef.current.getCurrentTime() || 0) - time) > 2) {
          playerRef.current.seekTo(time, true);
        }
        playerRef.current.playVideo();
      }
      setTimeout(() => {
        isSyncing.current = false;
      }, 1000);
    });

    socket.on("video-pause", ({ time }) => {
      isSyncing.current = true;
      setPlaying(false);
      if (playerRef.current && playerRef.current.getCurrentTime) {
        if (Math.abs((playerRef.current.getCurrentTime() || 0) - time) > 2) {
          playerRef.current.seekTo(time, true);
        }
        playerRef.current.pauseVideo();
      }
      setTimeout(() => {
        isSyncing.current = false;
      }, 1000);
    });

    socket.on("video-seek", ({ time }) => {
      isSyncing.current = true;
      if (playerRef.current && playerRef.current.seekTo) {
        playerRef.current.seekTo(time, true);
      }
      setTimeout(() => {
        isSyncing.current = false;
      }, 1000);
    });

    // Chat Sync
    socket.on("chat-message", (msg) => {
      setMessages((prev) => [...prev, msg]);
      setTimeout(
        () => chatEndRef.current?.scrollIntoView({ behavior: "auto" }),
        10,
      );
    });

    socket.on("chat-reply", (msg) => {
      setMessages((prev) => [...prev, msg]);
      setTimeout(
        () => chatEndRef.current?.scrollIntoView({ behavior: "auto" }),
        10,
      );
    });

    socket.on("video-upload", ({ fileDetail }) => {
      // fileDetail contains { name, buffer, type }
      if (fileDetail && fileDetail.buffer) {
        const blob = new Blob([fileDetail.buffer], {
          type: fileDetail.type || "video/mp4",
        });
        const objUrl = URL.createObjectURL(blob);
        setVideoUrl((prev) => {
          if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
          return objUrl;
        });
        setPlaying(false);
        setIsLoadingVideo(false);
      }
    });

    socket.on("speaking-state", ({ userId, isSpeaking }) => {
      setSpeakingUsers((prev) => ({ ...prev, [userId]: isSpeaking }));
    });

    socket.on("admin-changed", (newAdminId) => {
      setHostId(newAdminId);
      setIsHost(socket.id === newAdminId);
      // Toast logic could go here or simply let the UI state resolve it
    });

    return () => {
      socket.off("room-state");
      socket.off("user-joined");
      socket.off("user-left");
      socket.off("host-changed");
      socket.off("video-load");
      socket.off("video-play");
      socket.off("video-pause");
      socket.off("video-seek");
      socket.off("chat-message");
      socket.off("webrtc-offer");
      socket.off("webrtc-answer");
      socket.off("webrtc-ice-candidate");

      Object.values(peersRef.current).forEach((peer) => peer.destroy());
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      socket.off("video-upload");
      socket.off("chat-reply");
      socket.off("speaking-state");
      socket.off("admin-changed");

      if (checkAudioIntervalRef.current) {
        clearInterval(checkAudioIntervalRef.current);
      }
      Object.values(speakingTimeoutsRef.current).forEach((t) =>
        clearTimeout(t),
      );
    };
  }, [socketRef]);

  const createPeer = (
    userToSignal: string,
    callerID: string,
    stream: MediaStream,
  ) => {
    const peer = new Peer({
      initiator: true,
      trickle: true,
      stream,
    });

    peer.on("signal", (signal) => {
      if (signal.type === "offer") {
        socketRef.current?.emit("webrtc-offer", {
          target: userToSignal,
          callerId: callerID,
          offer: signal,
        });
      } else if ((signal as any).candidate) {
        socketRef.current?.emit("webrtc-ice-candidate", {
          target: userToSignal,
          senderId: callerID,
          candidate: signal,
        });
      }
    });

    peer.on("stream", (receivedStream) => {
      connectAudioStream(userToSignal, receivedStream);
    });

    return peer;
  };

  const addPeer = (
    incomingSignal: Peer.SignalData,
    callerID: string,
    stream: MediaStream,
  ) => {
    const peer = new Peer({
      initiator: false,
      trickle: true,
      stream,
    });

    peer.on("signal", (signal) => {
      if (signal.type === "answer") {
        socketRef.current?.emit("webrtc-answer", {
          target: callerID,
          answererId: socketRef.current?.id,
          answer: signal,
        });
      } else if ((signal as any).candidate) {
        socketRef.current?.emit("webrtc-ice-candidate", {
          target: callerID,
          senderId: socketRef.current?.id,
          candidate: signal,
        });
      }
    });

    peer.on("stream", (receivedStream) => {
      connectAudioStream(callerID, receivedStream);
    });

    peer.signal(incomingSignal);

    return peer;
  };

  const setupVoiceDetection = (userId: string, stream: MediaStream) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    }

    const audioCtx = audioContextRef.current;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser); // We don't connect to destination to avoid self-echo for local stream

    analysersRef.current[userId] = analyser;
    dataArraysRef.current[userId] = new Uint8Array(analyser.frequencyBinCount);

    if (!checkAudioIntervalRef.current) {
      checkAudioIntervalRef.current = setInterval(checkAudioLevels, 100);
    }
  };

  const checkAudioLevels = () => {
    let hasChanged = false;

    Object.entries(analysersRef.current).forEach(([userId, analyser]) => {
      const dataArray = dataArraysRef.current[userId];
      if (dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((val, a) => val + a, 0);
        const average = sum / dataArray.length;

        // Detect speaking. Lowered threshold so mobile mics trigger it.
        const isSpeakingNow = average > 4;
        const wasSpeaking = localSpeakingStateRef.current[userId] || false;

        if (isSpeakingNow) {
          if (!wasSpeaking) {
            localSpeakingStateRef.current[userId] = true;
            hasChanged = true;
          }
          if (speakingTimeoutsRef.current[userId]) {
            clearTimeout(speakingTimeoutsRef.current[userId]);
            delete speakingTimeoutsRef.current[userId];
          }
        } else {
          if (wasSpeaking && !speakingTimeoutsRef.current[userId]) {
            speakingTimeoutsRef.current[userId] = setTimeout(() => {
              if (localSpeakingStateRef.current[userId]) {
                localSpeakingStateRef.current[userId] = false;
                setSpeakingUsers((prev) => {
                  const next = { ...prev, [userId]: false };
                  if (userId === socketRef.current?.id) {
                    socketRef.current?.emit("user-speaking", {
                      roomId,
                      userId,
                      isSpeaking: false,
                    });
                  }
                  return next;
                });
              }
              delete speakingTimeoutsRef.current[userId];
            }, 400);
          }
        }
      }
    });

    if (hasChanged) {
      setSpeakingUsers((prev) => {
        const next = { ...prev };
        let anyActive = false;
        Object.entries(localSpeakingStateRef.current).forEach(
          ([uid, isSpk]) => {
            if (isSpk && !prev[uid]) {
              next[uid] = true;
              if (uid === socketRef.current?.id) {
                socketRef.current?.emit("user-speaking", {
                  roomId,
                  userId: uid,
                  isSpeaking: true,
                });
              }
            }
            if (isSpk) anyActive = true;
          },
        );

        // If speaking, make sure Context is running (browsers suspend it initially)
        if (anyActive && audioContextRef.current?.state === "suspended") {
          audioContextRef.current.resume();
        }

        return next;
      });
    }
  };

  const connectAudioStream = (userId: string, stream: MediaStream) => {
    if (!audioRefs.current[userId]) {
      const audio = new Audio();
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      audioRefs.current[userId] = audio;
      document.body.appendChild(audio); // Need to attach somewhere to play reliably
    }
    const audioEl = audioRefs.current[userId];
    audioEl.srcObject = stream;

    // Explicitly try playing to catch and handle autoplay policies
    const playPromise = audioEl.play();
    if (playPromise !== undefined) {
      playPromise.catch((error) => {
        console.warn("Auto-play was prevented by the browser:", error);

        // Keep trying to play on user interaction
        const enableAudio = () => {
          audioEl.play().catch((e) => console.error("Still blocked:", e));
          document.removeEventListener("click", enableAudio);
        };
        document.addEventListener("click", enableAudio);
      });
    }
  };

  const toggleMic = async () => {
    if (micEnabled) {
      setMicEnabled(false);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      Object.values(peersRef.current).forEach((peer) => peer.destroy());
      peersRef.current = {};

      // Clean up my own voice detection
      if (socketRef.current?.id) {
        delete analysersRef.current[socketRef.current.id];
        delete dataArraysRef.current[socketRef.current.id];
        if (speakingTimeoutsRef.current[socketRef.current.id]) {
          clearTimeout(speakingTimeoutsRef.current[socketRef.current.id]);
          delete speakingTimeoutsRef.current[socketRef.current.id];
        }
        localSpeakingStateRef.current[socketRef.current.id] = false;
        setSpeakingUsers((prev) => ({
          ...prev,
          [socketRef.current!.id]: false,
        }));
      }
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        localStreamRef.current = stream;
        setMicEnabled(true);

        if (socketRef.current?.id) {
          setupVoiceDetection(socketRef.current.id, stream);
          if (audioContextRef.current?.state === "suspended") {
            audioContextRef.current.resume();
          }
        }

        // create connection to all existing users
        participants.forEach((user) => {
          if (user.id !== socketRef.current?.id) {
            const peer = createPeer(
              user.id,
              socketRef.current?.id || "",
              stream,
            );
            peersRef.current[user.id] = peer;
          }
        });
      } catch (err) {
        console.error("Microphone access denied:", err);
        alert("Gagal mengakses mikrofon. Pastikan Anda memberikan izin.");
      }
    }
  };

  const extractYouTubeId = (url: string) => {
    if (!url) return null;
    const regex =
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value;
    setInputUrl(url);
    setIsValidUrl(extractYouTubeId(url) !== null);
  };

  // Handle Video Load
  const handleLoadVideo = () => {
    if (!inputUrl.trim() || !isValidUrl) return;
    setIsLoadingVideo(true);
    socketRef.current?.emit("video-load", { roomId, url: inputUrl });
    setVideoUrl(inputUrl);
    // Simulate loading feedback
    setTimeout(() => setIsLoadingVideo(false), 800);
  };

  // Handle Video Upload
  const fileUploadRef = useRef<HTMLInputElement>(null);
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoadingVideo(true);

    try {
      const url = URL.createObjectURL(file);
      socketRef.current?.emit("video-load", { roomId, url });
      setVideoUrl(url);
    } catch (err: any) {
      console.error("Failed to load video", err);
      alert(`Gagal meload video. Error: ${err.message}`);
    } finally {
      setIsLoadingVideo(false);
      if (fileUploadRef.current) fileUploadRef.current.value = ""; // Reset input
    }
  };

  // Handle Controls (Host only)
  const handlePlay = () => {
    if (isSyncing.current || !isHost) return;
    setPlaying(true);
    socketRef.current?.emit("video-play", {
      roomId,
      time: playerRef.current?.getCurrentTime() || 0,
    });
  };

  const handlePause = () => {
    if (isSyncing.current || !isHost) return;
    setPlaying(false);
    socketRef.current?.emit("video-pause", {
      roomId,
      time: playerRef.current?.getCurrentTime() || 0,
    });
  };

  const handleYouTubeStateChange = (e: any) => {
    // YT.PlayerState.PLAYING = 1, PAUSED = 2
    if (e.data === 1) handlePlay();
    if (e.data === 2) handlePause();
  };

  const handleYouTubeReady = (e: any) => {
    playerRef.current = e.target;
    // if playing state is true but we just loaded, try playing
    if (playing) {
      e.target.playVideo();
    }
  };

  const handleSeek = (time: number) => {
    if (isSyncing.current) return;
    socketRef.current?.emit("video-seek", { roomId, time });
  };

  const handleSendChat = (
    e?: React.FormEvent,
    customText?: string,
    imageUrl?: string,
    isSticker?: boolean,
  ) => {
    if (e) e.preventDefault();
    const val = customText ?? (chatInputRef.current?.value || "");
    if (!val.trim() && !imageUrl) return;

    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      sender: profile?.name || "Anonymous",
      text: val,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      avatar: profile?.avatar,
      frameColor: profile?.frameColor,
      replyTo: replyingTo || undefined,
      imageUrl,
      isSticker,
    };

    // Optimistic UI update
    setMessages((prev) => [...prev, msg]);
    setTimeout(
      () => chatEndRef.current?.scrollIntoView({ behavior: "auto" }),
      10,
    );

    socketRef.current?.emit(replyingTo ? "chat-reply" : "chat-message", {
      roomId,
      message: msg,
    });
    if (chatInputRef.current && !customText) {
      chatInputRef.current.value = "";
      chatInputRef.current.style.height = "auto";
    }
    setReplyingTo(null);
  };

  const handleChatImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      handleSendChat(undefined, "", dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId || "");
    // could show toast here
  };

  const transferAdmin = (targetId: string) => {
    if (!isHost) return;
    socketRef.current?.emit("transfer-admin", { roomId, newAdminId: targetId });
    setSelectedParticipant(null);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0A0F1A] overflow-hidden md:p-3">
      <div className="flex flex-col flex-1 overflow-hidden md:grid md:grid-cols-12 md:gap-4">
        {/* Left Column: Video & Controls */}
        <div className="md:col-span-8 flex flex-col md:bg-white/5 md:border md:border-white/10 md:rounded-3xl shrink-0 md:h-full w-full relative">
          {/* Back Button Floating on Video (Mobile Only) */}
          <button
            onClick={() => navigate("/dashboard")}
            className="md:hidden absolute top-4 left-4 z-50 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* Header for Desktop (Hidden on Mobile) */}
          <div className="hidden md:flex p-4 items-center justify-between border-b border-white/5 shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate("/dashboard")}
                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors text-white"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 bg-white/5 px-4 py-1.5 rounded-full border border-white/10">
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  socketRef.current?.connected
                    ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                    : "bg-red-500 animate-pulse",
                )}
                title={
                  socketRef.current?.connected ? "Connected" : "Disconnected"
                }
              />
              <span className="text-xs font-mono text-slate-500 tracking-widest uppercase ml-1">
                Room:
              </span>
              <span className="font-mono font-bold tracking-widest text-cyan-400 uppercase">
                {roomId}
              </span>
              <button
                onClick={copyRoomId}
                className="ml-2 hover:text-white transition-colors text-slate-400"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <div className="w-10">
              {isHost && (
                <span className="text-[9px] border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">
                  HOST
                </span>
              )}
            </div>
          </div>

          {/* 1. Video Player - TOP on Mobile */}
          <div className="w-full aspect-video bg-black shrink-0 relative z-10 shadow-[0_10px_30px_rgba(0,0,0,0.5)] md:shadow-none">
            {videoUrl ? (
              <div className="w-full h-full pointer-events-auto transition-opacity duration-1000 opacity-100 flex items-center justify-center">
                {!extractYouTubeId(videoUrl) ? (
                  <LocalVideoPlayer
                    url={videoUrl}
                    playing={playing}
                    controls={isHost}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onProgress={(state: any) => {
                      if (!isHost || isSyncing.current) return;
                    }}
                    ref={playerRef as any}
                  />
                ) : (
                  <YouTube
                    videoId={extractYouTubeId(videoUrl) || undefined}
                    opts={{
                      width: "100%",
                      height: "100%",
                      playerVars: {
                        playsinline: 1,
                        controls: isHost ? 1 : 0,
                        disablekb: isHost ? 0 : 1,
                        modestbranding: 1,
                        rel: 0,
                        origin: window.location.origin,
                      },
                    }}
                    onReady={handleYouTubeReady}
                    onStateChange={handleYouTubeStateChange}
                    className="w-full h-full absolute inset-0"
                    iframeClassName="w-full h-full"
                  />
                )}
                {!isHost && (
                  <div
                    className="absolute inset-0 z-20 cursor-default"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  />
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3 p-4 text-slate-500 bg-black/40">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center border border-white/10 transition-transform">
                  <Youtube className="w-8 h-8 text-white/50" />
                </div>
                <p className="text-[10px] uppercase tracking-widest font-bold mt-2">
                  No video loaded
                </p>
              </div>
            )}
          </div>

          {/* 2. Controls & Actions Wrapped in Glass Box */}
          <div className="flex flex-col p-3 md:p-5 gap-4 shrink-0 transition-all z-20 md:border-none border-t border-white/5">
            <div className="bg-[#161c2d] border border-[#2e3c5a] shadow-lg rounded-[24px] p-4 flex flex-col gap-4">
              <div className="flex flex-row gap-3 items-center w-full">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={inputUrl}
                    onChange={handleUrlChange}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    placeholder="Paste link YouTube..."
                    className={cn(
                      "w-full bg-[#0f1521] border rounded-xl px-4 py-3 text-[13px] text-slate-200 focus:outline-none transition-all duration-300 font-mono placeholder:text-slate-500",
                      isValidUrl === null
                        ? "border-[#2e3c5a] focus:border-cyan-500/50"
                        : isValidUrl
                          ? "border-[#059669] focus:border-[#10b981] border-[1.5px]"
                          : "border-red-500/50 focus:border-red-400 border-[1.5px]",
                    )}
                  />
                </div>
                <button
                  onClick={handleLoadVideo}
                  disabled={!inputUrl.trim() || isLoadingVideo}
                  className="py-3 px-4 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl font-bold text-[11px] uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all duration-200 text-white shrink-0 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center"
                >
                  {isLoadingVideo && inputUrl.trim() ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    "LOAD"
                  )}
                </button>

                <button
                  onClick={() => fileUploadRef.current?.click()}
                  disabled={isLoadingVideo}
                  className="p-3 bg-[#0f1521] border border-[#2e3c5a] rounded-xl text-slate-400 hover:text-white hover:bg-[#1e293b] active:scale-95 transition-all duration-200 shrink-0 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center"
                  title="Upload File"
                >
                  {isLoadingVideo && !inputUrl.trim() ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <FolderOpen className="w-5 h-5" />
                  )}
                </button>
                {/* Hidden File Input */}
                <input
                  type="file"
                  ref={fileUploadRef}
                  accept="video/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />

                <button
                  onClick={toggleMic}
                  className={cn(
                    "p-3 shrink-0 rounded-xl border transition-all flex items-center justify-center",
                    micEnabled
                      ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.2)]"
                      : "bg-[#0f1521] border-[#2e3c5a] text-slate-400 hover:bg-[#1e293b] hover:text-white",
                  )}
                  title="Voice Chat"
                >
                  {micEnabled ? (
                    <Mic className="w-5 h-5" />
                  ) : (
                    <MicOff className="w-5 h-5" />
                  )}
                </button>
              </div>

              {/* Participants Section in Left Column */}
              <div className="flex flex-col gap-3">
                <span className="text-[11px] uppercase tracking-widest text-[#38bdf8] font-bold">
                  Participants ({participants.length})
                </span>
                <div className="flex gap-4 overflow-x-auto py-3 px-2 -mx-2 no-scrollbar items-center">
                  {participants.map((p) => {
                    const isSpeaking = speakingUsers[p.id];
                    const baseColor = p.frameColor || "#38bdf8";

                    return (
                      <div
                        key={p.id}
                        className={cn(
                          "flex flex-col items-center gap-2 shrink-0 group",
                          isSpeaking && "speaking",
                        )}
                      >
                        <div
                          className="relative avatar-wrapper"
                          style={{ "--color": baseColor } as any}
                        >
                          <div
                            onClick={() =>
                              setSelectedParticipant(
                                selectedParticipant === p.id ? null : p.id,
                              )
                            }
                            className={cn(
                              "avatar cursor-pointer w-14 h-14 md:w-16 md:h-16 rounded-full border-[3px] transition-all duration-300 flex items-center justify-center bg-[#0a0f1a] relative z-10",
                              selectedParticipant === p.id
                                ? "ring-2 ring-white ring-offset-2 ring-offset-[#0f172a]"
                                : "",
                            )}
                            style={
                              {
                                borderColor: `${baseColor}40`,
                              } as any
                            }
                          >
                            {p.avatar ? (
                              <img
                                src={p.avatar}
                                alt={p.name}
                                className="w-[calc(100%-6px)] h-[calc(100%-6px)] rounded-full object-cover"
                              />
                            ) : (
                              <span
                                className="text-xl font-bold"
                                style={{ color: baseColor }}
                              >
                                {p.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="sound-waves">
                            <div className="wave"></div>
                            <div className="wave"></div>
                            <div className="wave"></div>
                          </div>
                          {p.id === hostId && (
                            <div className="absolute -bottom-2 lg:-bottom-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-[9px] font-extrabold px-3 py-0.5 rounded-full border-[1.5px] border-[#161c2d] z-10 uppercase whitespace-nowrap shadow-sm tracking-wider">
                              Host
                            </div>
                          )}
                          {/* Admin Transfer Popup */}
                          {selectedParticipant === p.id &&
                            isHost &&
                            p.id !== hostId && (
                              <div className="absolute top-full mt-3 left-1/2 -translate-x-1/2 z-50 bg-[#161c2d] border border-[#2e3c5a] shadow-xl rounded-xl p-2 w-max animate-in fade-in zoom-in duration-200">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    transferAdmin(p.id);
                                  }}
                                  className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-200 hover:text-white hover:bg-white/5 rounded-lg transition-colors whitespace-nowrap w-full"
                                >
                                  <Crown className="w-4 h-4 text-cyan-400" />
                                  Alihkan sebagai host
                                </button>
                              </div>
                            )}
                        </div>
                        <div className="text-[11px] font-semibold text-slate-300 xl:text-[12px] truncate w-20 text-center mt-1">
                          {p.name.split(" ")[0]}
                        </div>
                      </div>
                    );
                  })}
                  {participants.length === 0 && (
                    <div className="text-slate-500 text-xs italic opacity-50 py-4">
                      Waiting to connect...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Chat (Bottom on Mobile) */}
        <div className="md:col-span-4 flex flex-col flex-1 overflow-hidden bg-transparent pb-4 md:pb-0 z-20">
          {/* Chat Panel */}
          <div className="flex-1 overflow-hidden relative flex flex-col">
            {/* Header for Chat & Room Info (Mobile) */}
            <div className="px-3 py-2 border-b border-[#2e3c5a]/40 flex items-center justify-between z-30 shrink-0 bg-[#0a0f1a] md:bg-[#0f1521] md:border md:border-[#2e3c5a] md:rounded-t-[24px]">
              <span className="text-[10px] uppercase tracking-widest text-[#7dd3fc] font-bold">
                Live Chat
              </span>

              <div className="flex items-center gap-2">
                <label
                  className="text-slate-400 hover:text-cyan-400 cursor-pointer p-1 rounded-md hover:bg-white/5 transition-colors"
                  title="Change Background"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleWallpaperUpload}
                  />
                </label>

                <div className="md:hidden flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-[12px] border border-white/10">
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      socketRef.current?.connected
                        ? "bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.6)]"
                        : "bg-red-500 animate-pulse",
                    )}
                  />
                  <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest ml-0.5">
                    Room:
                  </span>
                  <span className="text-[11px] font-mono font-bold tracking-widest text-cyan-400">
                    {roomId}
                  </span>
                  <button
                    onClick={copyRoomId}
                    className="ml-1 text-slate-400 hover:text-white transition-colors active:scale-90 flex-shrink-0 p-1 outline-none"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 relative flex flex-col overflow-hidden w-full bg-[#090d14] md:bg-[#0a0f1a]/80 md:backdrop-blur-2xl md:border-x md:border-b md:border-[#2e3c5a] md:rounded-b-[24px] md:shadow-2xl">
              {chatWallpaper && (
                <div className="absolute inset-0 z-0 pointer-events-none">
                  <img
                    src={chatWallpaper}
                    style={{ opacity: wallpaperOpacity }}
                    className="w-full h-full object-cover object-center transition-opacity"
                    alt="chat-wallpaper"
                  />
                </div>
              )}

              <div className="flex-1 overflow-y-auto relative z-10 w-full">
                <div className="p-3 space-y-1 md:space-y-2 relative z-10 min-h-full">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex gap-1.5 mb-2",
                        msg.sender === profile?.name
                          ? "justify-end"
                          : "justify-start",
                      )}
                    >
                      {msg.sender !== profile?.name &&
                        (msg.avatar ? (
                          <div
                            className="w-6 h-6 rounded-full p-[1px] shrink-0 mt-0.5 flex-none"
                            style={{ background: msg.frameColor || "#333" }}
                          >
                            <img
                              src={msg.avatar}
                              alt={msg.sender}
                              className="w-full h-full rounded-full object-cover bg-black/50"
                            />
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-full shrink-0 flex-none bg-[#1e293b] flex items-center justify-center border border-white/5 mt-0.5">
                            <span className="text-[10px] font-bold text-slate-300">
                              {msg.sender.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        ))}
                      <div className="flex flex-col min-w-0 max-w-[85%]">
                        <div
                          className={cn(
                            "relative group w-fit max-w-full",
                            msg.isSticker && !msg.text
                              ? "bg-transparent p-0"
                              : cn(
                                  "backdrop-blur-sm shadow-sm",
                                  msg.sender === profile?.name
                                    ? "bg-[#28364b]/95 border border-slate-700/50 rounded-xl rounded-tr-[2px]"
                                    : "bg-[#1e293b]/95 border border-slate-700/40 rounded-xl rounded-tl-[2px]",
                                ),
                            !msg.text && msg.imageUrl && !msg.isSticker
                              ? "p-1"
                              : msg.isSticker && !msg.text
                                ? ""
                                : "py-1.5 px-2.5",
                          )}
                        >
                          {(!msg.isSticker || msg.text) &&
                            msg.sender !== profile?.name && (
                              <div className="flex items-baseline gap-3 mb-0.5 px-0.5">
                                <span
                                  className="text-[11px] font-bold text-slate-300 truncate leading-none"
                                  style={{ color: msg.frameColor || "#cbd5e1" }}
                                >
                                  {msg.sender}
                                </span>
                              </div>
                            )}
                          {msg.replyTo && (
                            <div
                              className={cn(
                                "mb-1 pl-1.5 border-l-2 border-cyan-500/50 bg-black/20 py-0.5 px-1.5 flex justify-between gap-1 items-center",
                                msg.isSticker && !msg.text
                                  ? "rounded-lg"
                                  : "rounded-sm",
                              )}
                            >
                              <div className="flex flex-col truncate flex-1 min-w-0">
                                <span className="text-[10px] font-bold text-cyan-400 leading-tight">
                                  {msg.replyTo.sender}
                                </span>
                                <span className="text-[10px] text-slate-300 truncate h-3 overflow-hidden leading-tight">
                                  {msg.replyTo.text}
                                </span>
                              </div>
                              {msg.replyTo.imageUrl && (
                                <img
                                  src={msg.replyTo.imageUrl}
                                  className="w-6 h-6 object-cover rounded-[3px] opacity-80 shrink-0"
                                  alt="reply-thumb"
                                />
                              )}
                            </div>
                          )}
                          <div className="flex flex-col w-full max-w-full">
                            {msg.imageUrl && (
                              <img
                                src={msg.imageUrl}
                                className={cn(
                                  "object-contain",
                                  msg.isSticker && !msg.text
                                    ? "max-w-[120px] md:max-w-[140px] drop-shadow-lg"
                                    : "rounded-lg max-w-[140px] md:max-w-[180px] border border-white/5",
                                )}
                                alt={msg.isSticker ? "sticker" : "photo"}
                              />
                            )}
                            {msg.text && (
                              <p className="text-[13px] text-slate-100 break-words leading-[1.3] pt-0.5 whitespace-pre-wrap">
                                {msg.text}
                              </p>
                            )}
                          </div>
                          <div
                            className={cn(
                              "flex items-center justify-end gap-1 mt-0.5",
                              msg.isSticker && !msg.text
                                ? "absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4 drop-shadow-md bg-black/50 backdrop-blur-sm rounded-full px-1.5 py-[2px] w-fit z-10"
                                : "px-0.5",
                            )}
                          >
                            <span className="text-[9px] text-slate-400/80 font-mono leading-none">
                              {msg.time}
                            </span>
                            {msg.sender === profile?.name && (
                              <CheckCheck className="w-3 h-3 text-cyan-500" />
                            )}
                          </div>
                          <button
                            onClick={() =>
                              setReplyingTo({
                                id: msg.id,
                                sender: msg.sender,
                                text: msg.isSticker
                                  ? "Sticker"
                                  : msg.text || "Photo",
                                imageUrl: msg.imageUrl,
                              })
                            }
                            className={cn(
                              "absolute top-1/2 -translate-y-1/2 opacity-30 sm:opacity-0 sm:group-hover:opacity-100 transition-all p-1 hover:bg-white/10 rounded-full active:scale-95 z-20 bg-black/40 backdrop-blur-md outline-none",
                              msg.sender === profile?.name
                                ? "-left-8"
                                : "-right-8",
                              msg.isSticker &&
                                !msg.text &&
                                (msg.sender === profile?.name
                                  ? "-left-10"
                                  : "-right-10"),
                            )}
                            title="Reply"
                          >
                            <Reply className="w-4 h-4 text-slate-300" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              </div>

              <div className="flex flex-col shrink-0 z-20 relative bg-transparent md:border-t border-white/5 pb-1 md:pb-0">
                {replyingTo && (
                  <div className="px-3 py-1.5 flex items-center justify-between bg-[#0f1521]/90 backdrop-blur-md border-l-4 border-cyan-500 relative">
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-[10px] text-cyan-400 font-bold leading-tight">
                        {replyingTo.sender}
                      </span>
                      <span className="text-[12px] text-slate-300 truncate leading-tight">
                        {replyingTo.text}
                      </span>
                    </div>
                    {replyingTo.imageUrl && (
                      <img
                        src={replyingTo.imageUrl}
                        className="w-7 h-7 object-cover rounded mx-2 shrink-0"
                        alt="reply-thumb"
                      />
                    )}
                    <button
                      onClick={() => setReplyingTo(null)}
                      className="p-1.5 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors shrink-0 outline-none"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {showStickers && (
                  <div className="h-48 md:h-64 bg-[#1e293b] border-t border-slate-700/50 flex flex-col">
                    <div className="flex-1 p-2 overflow-y-auto w-full">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-400">
                          Custom Stickers
                        </span>
                      </div>
                      {customStickers.length === 0 ? (
                        <div className="text-center text-slate-500 text-[11px] mt-10">
                          Belum ada custom sticker
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {customStickers.map((sticker, idx) => (
                            <div
                              key={idx}
                              className="relative group w-[72px] h-[72px] rounded overflow-hidden"
                            >
                              <img
                                src={sticker}
                                alt={`sticker-${idx}`}
                                className="w-full h-full object-contain cursor-pointer hover:opacity-80 transition-opacity drop-shadow-md"
                                onClick={() => {
                                  handleSendChat(undefined, "", sticker, true);
                                  setShowStickers(false);
                                }}
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeSticker(idx);
                                }}
                                className="absolute top-1 right-1 bg-red-500/80 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity outline-none"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Bottom Toolbar for Sticker Folders */}
                    <div className="h-10 bg-[#0f1521] flex items-center px-2 gap-3 overflow-x-auto shrink-0 border-t border-slate-800">
                      <div className="p-1.5 bg-[#1e293b] rounded text-slate-300">
                        <Smile className="w-4 h-4" />
                      </div>
                      <div className="p-1.5 hover:bg-[#1e293b] rounded text-slate-500 cursor-pointer transition-colors">
                        <FolderOpen className="w-4 h-4" />
                      </div>
                      <div className="w-px h-4 bg-slate-700 mx-1"></div>
                      <label className="p-1 text-cyan-400 hover:text-cyan-300 cursor-pointer flex items-center shrink-0">
                        <div className="p-1 bg-cyan-500/10 rounded flex items-center justify-center">
                          <span className="text-[10px] font-bold">
                            + Tambah Paket Baru
                          </span>
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleCreateSticker}
                        />
                      </label>
                    </div>
                  </div>
                )}

                <form
                  onSubmit={handleSendChat}
                  className="p-2 md:p-3 w-full flex items-end gap-2 bg-transparent"
                >
                  <div className="flex-1 bg-[#1e293b]/70 backdrop-blur-md border border-slate-700/50 rounded-[24px] flex items-center pr-2 pl-1 relative z-10 transition-colors focus-within:border-cyan-500/40 shadow-sm">
                    <button
                      type="button"
                      onClick={() => setShowStickers(!showStickers)}
                      className={cn(
                        "p-2 text-slate-400 hover:text-white shrink-0 active:scale-95 transition-all",
                        showStickers && "text-cyan-400",
                      )}
                    >
                      <Smile className="w-6 h-6" />
                    </button>
                    <textarea
                      ref={chatInputRef}
                      placeholder="Message..."
                      rows={1}
                      className="flex-1 bg-transparent border-none py-3 text-[14px] focus:outline-none text-slate-200 placeholder:text-slate-500 min-w-0 resize-none max-h-[100px] overflow-y-auto leading-[1.4]"
                      onFocus={() => setShowStickers(false)}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = "auto";
                        target.style.height = `${Math.min(target.scrollHeight, 100)}px`;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendChat(e);
                        }
                      }}
                    />
                    <label className="p-2 text-slate-400 hover:text-white shrink-0 cursor-pointer active:scale-95 transition-all">
                      <ImageIcon className="w-[22px] h-[22px]" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleChatImageUpload}
                      />
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="w-11 h-11 md:w-12 md:h-12 rounded-full border flex items-center justify-center transition-colors disabled:opacity-50 border-cyan-500/40 bg-gradient-to-tr from-cyan-600 to-cyan-400 text-[#090d14] hover:brightness-110 shrink-0 shadow-[0_0_20px_rgba(6,182,212,0.3)] mb-0.5 active:scale-95"
                  >
                    <SendHorizonal className="w-[18px] h-[18px] md:w-[20px] md:h-[20px] -ml-0.5" />
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Wallpaper Preview Modal */}
        {previewWallpaper && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-[#0f1521] border border-[#2e3c5a] rounded-2xl w-full max-w-sm overflow-hidden flex flex-col shadow-2xl relative">
              {/* Preview Area */}
              <div className="relative w-full h-[55dvh] bg-[#090d14] overflow-hidden">
                <img
                  src={previewWallpaper}
                  style={{ opacity: previewOpacity }}
                  className="absolute inset-0 w-full h-full object-cover object-center transition-opacity"
                  alt="preview"
                />
              </div>

              {/* Controls */}
              <div className="p-4 space-y-5 bg-[#0f1521] border-t border-[#2e3c5a]">
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-semibold text-slate-300">
                      Opacity (Kecerahan)
                    </span>
                    <span className="text-xs text-slate-400">
                      {Math.round(previewOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={previewOpacity}
                    onChange={(e) =>
                      setPreviewOpacity(parseFloat(e.target.value))
                    }
                    className="w-full accent-cyan-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="flex gap-2 pt-1 border-t border-slate-800/50">
                  <button
                    onClick={() => setPreviewWallpaper(null)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-white/5 hover:bg-white/10 text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={resetWallpaper}
                    className="flex-none px-4 py-2.5 rounded-xl font-bold text-sm bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    onClick={applyWallpaper}
                    className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-tr from-cyan-600 to-cyan-400 hover:brightness-110 text-[#090d14] transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
