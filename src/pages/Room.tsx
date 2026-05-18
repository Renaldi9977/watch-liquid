import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import YouTube, { YouTubeProps } from 'react-youtube';
import ReactPlayer from 'react-player';
import { useSocket } from '../store/useSocket';
import { useStore } from '../store/useStore';
import { ArrowLeft, Copy, Mic, MicOff, Send, Users, Youtube, Upload, Reply, Crown, X, FolderOpen, UploadCloud } from 'lucide-react';
import { cn } from '../lib/utils';
import Peer from 'simple-peer';
import { LocalVideoPlayer } from '../components/LocalVideoPlayer';

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
    replyTo?: { id: string; sender: string; text: string; };
}

export default function Room() {
    const { roomId } = useParams<{ roomId: string }>();
    const navigate = useNavigate();
    const socketRef = useSocket(roomId);
    const profile = useStore(state => state.profile);

    // State
    const [participants, setParticipants] = useState<User[]>([]);
    const [hostId, setHostId] = useState<string>('');
    const [isHost, setIsHost] = useState(false);
    
    // Video State
    const [videoUrl, setVideoUrl] = useState('');
    const [inputUrl, setInputUrl] = useState('');
    const [playing, setPlaying] = useState(false);
    const [isValidUrl, setIsValidUrl] = useState<boolean | null>(null);
    const [isLoadingVideo, setIsLoadingVideo] = useState(false);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const playerRef = useRef<any>(null);
    const isSyncing = useRef(false);

    // Chat State
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Form state
    const [replyingTo, setReplyingTo] = useState<{ id: string; sender: string; text: string } | null>(null);
    const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);

    // Audio/WebRTC State
    const [micEnabled, setMicEnabled] = useState(false);
    const localStreamRef = useRef<MediaStream | null>(null);
    const peersRef = useRef<Record<string, Peer.Instance>>({});
    const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
    
    // Voice activity detection
    const [speakingUsers, setSpeakingUsers] = useState<Record<string, boolean>>({});
    const audioContextRef = useRef<AudioContext | null>(null);
    const analysersRef = useRef<Record<string, AnalyserNode>>({});
    const dataArraysRef = useRef<Record<string, Uint8Array>>({});
    const checkAudioIntervalRef = useRef<any>(null);

    // layout responsive state
    // removed activeTab since we use combined layout on mobile

    useEffect(() => {
        if (!socketRef.current) return;
        const socket = socketRef.current;

        socket.on('room-state', (state) => {
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

        socket.on('user-joined', (user) => {
            setParticipants(prev => [...prev, user]);
            
            // Initiate WebRTC peer connection
            if (micEnabled && localStreamRef.current) {
               const peer = createPeer(user.id, socket.id, localStreamRef.current);
               peersRef.current[user.id] = peer;
            }
        });

        socket.on('user-left', (id) => {
            setParticipants(prev => prev.filter(u => u.id !== id));
            if (peersRef.current[id]) {
                peersRef.current[id].destroy();
                delete peersRef.current[id];
            }
        });

        socket.on('host-changed', (newHostId) => {
            setHostId(newHostId);
            if (newHostId === socket.id) setIsHost(true);
        });

        socket.on("webrtc-offer", ({ offer, callerId }) => {
            if (!micEnabled || !localStreamRef.current) return;
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
        socket.on('video-load', ({ url }) => {
            setVideoUrl(url);
            setPlaying(false);
        });

        socket.on('video-play', ({ time }) => {
             isSyncing.current = true;
             setPlaying(true);
             if (playerRef.current && playerRef.current.getCurrentTime) {
                 if (Math.abs((playerRef.current.getCurrentTime() || 0) - time) > 2) {
                     playerRef.current.seekTo(time, true);
                 }
                 playerRef.current.playVideo();
             }
             setTimeout(() => { isSyncing.current = false; }, 1000);
        });

        socket.on('video-pause', ({ time }) => {
            isSyncing.current = true;
            setPlaying(false);
            if (playerRef.current && playerRef.current.getCurrentTime) {
                if (Math.abs((playerRef.current.getCurrentTime() || 0) - time) > 2) {
                     playerRef.current.seekTo(time, true);
                }
                playerRef.current.pauseVideo();
            }
            setTimeout(() => { isSyncing.current = false; }, 1000);
        });

        socket.on('video-seek', ({ time }) => {
            isSyncing.current = true;
            if (playerRef.current && playerRef.current.seekTo) {
                playerRef.current.seekTo(time, true);
            }
            setTimeout(() => { isSyncing.current = false; }, 1000);
        });

        // Chat Sync
        socket.on('chat-message', (msg) => {
            setMessages(prev => [...prev, msg]);
            setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        });

        socket.on('chat-reply', (msg) => {
            setMessages(prev => [...prev, msg]);
            setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        });

        socket.on('video-upload', ({ fileDetail }) => {
            // fileDetail contains { name, buffer, type }
            if (fileDetail && fileDetail.buffer) {
                const blob = new Blob([fileDetail.buffer], { type: fileDetail.type || 'video/mp4' });
                const objUrl = URL.createObjectURL(blob);
                setVideoUrl(objUrl);
                setPlaying(false);
                setIsLoadingVideo(false);
            }
        });

        socket.on('speaking-state', ({ userId, isSpeaking }) => {
            setSpeakingUsers(prev => ({ ...prev, [userId]: isSpeaking }));
        });

        socket.on('admin-changed', (newAdminId) => {
            setHostId(newAdminId);
            setIsHost(socket.id === newAdminId);
            // Toast logic could go here or simply let the UI state resolve it
        });

        return () => {
            socket.off('room-state');
            socket.off('user-joined');
            socket.off('user-left');
            socket.off('host-changed');
            socket.off('video-load');
            socket.off('video-play');
            socket.off('video-pause');
            socket.off('video-seek');
            socket.off('chat-message');
            socket.off("webrtc-offer");
            socket.off("webrtc-answer");
            socket.off("webrtc-ice-candidate");
            
            Object.values(peersRef.current).forEach(peer => peer.destroy());
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
            socket.off('video-upload');
            socket.off('chat-reply');
            socket.off('speaking-state');
            socket.off('admin-changed');

            if (videoUrl && videoUrl.startsWith('blob:')) {
                URL.revokeObjectURL(videoUrl);
            }
        };
    }, [socketRef, micEnabled, videoUrl]);

    const createPeer = (userToSignal: string, callerID: string, stream: MediaStream) => {
        const peer = new Peer({
            initiator: true,
            trickle: true,
            stream,
        });

        peer.on("signal", signal => {
            if (signal.type === "offer") {
                socketRef.current?.emit("webrtc-offer", { target: userToSignal, callerId: callerID, offer: signal });
            } else if ((signal as any).candidate) {
                socketRef.current?.emit("webrtc-ice-candidate", { target: userToSignal, senderId: callerID, candidate: signal });
            }
        });

        peer.on("stream", receivedStream => {
             connectAudioStream(userToSignal, receivedStream);
        });

        return peer;
    }

    const addPeer = (incomingSignal: Peer.SignalData, callerID: string, stream: MediaStream) => {
        const peer = new Peer({
            initiator: false,
            trickle: true,
            stream,
        });

        peer.on("signal", signal => {
             if (signal.type === "answer") {
                 socketRef.current?.emit("webrtc-answer", { target: callerID, answererId: socketRef.current?.id, answer: signal });
             } else if ((signal as any).candidate) {
                socketRef.current?.emit("webrtc-ice-candidate", { target: callerID, senderId: socketRef.current?.id, candidate: signal });
            }
        });

        peer.on("stream", receivedStream => {
            connectAudioStream(callerID, receivedStream);
        });

        peer.signal(incomingSignal);

        return peer;
    }

    const setupVoiceDetection = (userId: string, stream: MediaStream) => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        const audioCtx = audioContextRef.current;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser); // We don't connect to destination to avoid self-echo for local stream
        
        analysersRef.current[userId] = analyser;
        dataArraysRef.current[userId] = new Uint8Array(analyser.frequencyBinCount);
        
        if (!checkAudioIntervalRef.current) {
            checkAudioIntervalRef.current = setInterval(checkAudioLevels, 100);
        }
    };

    const checkAudioLevels = () => {
        const newSpeakingState: Record<string, boolean> = {};
        let anySpeaking = false;
        
        Object.entries(analysersRef.current).forEach(([userId, analyser]) => {
            const dataArray = dataArraysRef.current[userId];
            if (dataArray) {
                analyser.getByteFrequencyData(dataArray);
                const sum = dataArray.reduce((val, a) => val + a, 0);
                const average = sum / dataArray.length;
                // Threshold for detecting speech. Lowered so mobile mics trigger it.
                const isSpeaking = average > 2;
                newSpeakingState[userId] = isSpeaking;
                if (isSpeaking) anySpeaking = true;
            }
        });
        
        setSpeakingUsers(prev => {
            const hasChanged = Object.keys(newSpeakingState).some(id => prev[id] !== newSpeakingState[id]);
            
            // Broadcast your own speaking state if changed
            if (socketRef.current?.id && newSpeakingState[socketRef.current.id] !== undefined && prev[socketRef.current.id] !== newSpeakingState[socketRef.current.id]) {
                socketRef.current.emit("user-speaking", { roomId, userId: socketRef.current.id, isSpeaking: newSpeakingState[socketRef.current.id] });
            }

            return hasChanged ? { ...prev, ...newSpeakingState } : prev;
        });
        
        // If speaking, make sure Context is running (browsers suspend it initially)
        if (anySpeaking && audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume();
        }
    };

    const connectAudioStream = (userId: string, stream: MediaStream) => {
        if (!audioRefs.current[userId]) {
            const audio = new Audio();
            audio.autoplay = true;
            audioRefs.current[userId] = audio;
            document.body.appendChild(audio); // Need to attach somewhere to play reliably
        }
        audioRefs.current[userId].srcObject = stream;
        setupVoiceDetection(userId, stream);
    };

    const toggleMic = async () => {
        if (micEnabled) {
            setMicEnabled(false);
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
                localStreamRef.current = null;
            }
            Object.values(peersRef.current).forEach(peer => peer.destroy());
            peersRef.current = {};
            
            // Clean up my own voice detection
            if (socketRef.current?.id) {
                delete analysersRef.current[socketRef.current.id];
                delete dataArraysRef.current[socketRef.current.id];
                setSpeakingUsers(prev => ({ ...prev, [socketRef.current!.id]: false }));
            }
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                localStreamRef.current = stream;
                setMicEnabled(true);
                
                if (socketRef.current?.id) {
                     setupVoiceDetection(socketRef.current.id, stream);
                }
                
                // create connection to all existing users
                participants.forEach(user => {
                    if (user.id !== socketRef.current?.id) {
                        const peer = createPeer(user.id, socketRef.current?.id || '', stream);
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
        const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#]+)/;
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
        socketRef.current?.emit('video-load', { roomId, url: inputUrl });
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
            socketRef.current?.emit('video-load', { roomId, url });
            setVideoUrl(url);
        } catch (err: any) {
            console.error("Failed to load video", err);
            alert(`Gagal meload video. Error: ${err.message}`);
        } finally {
            setIsLoadingVideo(false);
            if (fileUploadRef.current) fileUploadRef.current.value = ''; // Reset input
        }
    };

    // Handle Controls (Host only)
    const handlePlay = () => {
        if (isSyncing.current || !isHost) return;
        setPlaying(true);
        socketRef.current?.emit('video-play', { roomId, time: playerRef.current?.getCurrentTime() || 0 });
    };

    const handlePause = () => {
        if (isSyncing.current || !isHost) return;
        setPlaying(false);
        socketRef.current?.emit('video-pause', { roomId, time: playerRef.current?.getCurrentTime() || 0 });
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
        socketRef.current?.emit('video-seek', { roomId, time });
    };

    const handleSendChat = (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim()) return;
        
        const msg = {
            id: Math.random().toString(36).substring(7),
            sender: profile?.name || 'Anonymous',
            text: chatInput,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            avatar: profile?.avatar,
            frameColor: profile?.frameColor,
            replyTo: replyingTo || undefined
        };
        
        socketRef.current?.emit(replyingTo ? 'chat-reply' : 'chat-message', { roomId, message: msg });
        setChatInput('');
        setReplyingTo(null);
    };

    const copyRoomId = () => {
        navigator.clipboard.writeText(roomId || '');
        // could show toast here
    };

    const transferAdmin = (targetId: string) => {
        if (!isHost) return;
        socketRef.current?.emit('transfer-admin', { roomId, newAdminId: targetId });
        setSelectedParticipant(null);
    };

    return (
        <div className="flex flex-col h-[100dvh] bg-[#0A0F1A] overflow-hidden md:p-3">
            <div className="flex flex-col flex-1 overflow-hidden md:grid md:grid-cols-12 md:gap-4">
                
                {/* Left Column: Video & Controls */}
                <div className="md:col-span-8 flex flex-col md:bg-white/5 md:border md:border-white/10 md:rounded-3xl shrink-0 md:h-full w-full relative">
                    
                    {/* Back Button Floating on Video (Mobile Only) */}
                    <button onClick={() => navigate('/dashboard')} className="md:hidden absolute top-4 left-4 z-50 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </button>

                {/* Header for Desktop (Hidden on Mobile) */}
                <div className="hidden md:flex p-4 items-center justify-between border-b border-white/5 shrink-0">
                    <div className="flex items-center gap-3">
                        <button onClick={() => navigate('/dashboard')} className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors text-white">
                            <ArrowLeft className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="flex items-center gap-2 bg-white/5 px-4 py-1.5 rounded-full border border-white/10">
                        <div className={cn("w-2 h-2 rounded-full", socketRef.current?.connected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-red-500 animate-pulse")} title={socketRef.current?.connected ? "Connected" : "Disconnected"} />
                        <span className="text-xs font-mono text-slate-500 tracking-widest uppercase ml-1">Room:</span>
                        <span className="font-mono font-bold tracking-widest text-cyan-400 uppercase">{roomId}</span>
                        <button onClick={copyRoomId} className="ml-2 hover:text-white transition-colors text-slate-400">
                            <Copy className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="w-10">
                        {isHost && <span className="text-[9px] border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">HOST</span>}
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
                                        width: '100%', 
                                        height: '100%',
                                        playerVars: {
                                            playsinline: 1,
                                            controls: isHost ? 1 : 0,
                                            disablekb: isHost ? 0 : 1,
                                            modestbranding: 1,
                                            rel: 0,
                                            origin: window.location.origin
                                        }
                                    }}
                                    onReady={handleYouTubeReady}
                                    onStateChange={handleYouTubeStateChange}
                                    className="w-full h-full absolute inset-0"
                                    iframeClassName="w-full h-full"
                                />
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-3 p-4 text-slate-500 bg-black/40">
                             <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center border border-white/10 transition-transform">
                                <Youtube className="w-8 h-8 text-white/50" />
                             </div>
                             <p className="text-[10px] uppercase tracking-widest font-bold mt-2">No video loaded</p>
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
                                        isValidUrl === null ? "border-[#2e3c5a] focus:border-cyan-500/50" : 
                                        isValidUrl ? "border-[#059669] focus:border-[#10b981] border-[1.5px]" : 
                                        "border-red-500/50 focus:border-red-400 border-[1.5px]"
                                    )}
                                />
                            </div>
                            <button 
                                onClick={handleLoadVideo}
                                disabled={!inputUrl.trim() || isLoadingVideo}
                                className="py-3 px-5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl font-bold text-[11px] uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all duration-200 text-white shrink-0 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center min-w-[80px]"
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
                                className="py-3 px-4 bg-gradient-to-br border border-white/10 from-slate-700 to-slate-800 rounded-xl font-bold text-[11px] uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all duration-200 text-white shrink-0 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center min-w-[80px] gap-2"
                            >
                                {isLoadingVideo && !inputUrl.trim() ? (
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>
                                        <Upload className="w-4 h-4" /> UPLOAD
                                    </>
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
                                className={cn("p-3 shrink-0 rounded-xl border transition-all flex items-center justify-center", micEnabled ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.2)]" : "bg-[#0f1521] border-[#2e3c5a] text-slate-400 hover:bg-[#1e293b] hover:text-white")}
                                title="Voice Chat"
                            >
                                {micEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                            </button>
                        </div>

                        {/* Participants Section in Left Column */}
                        <div className="flex flex-col gap-3">
                            <span className="text-[11px] uppercase tracking-widest text-[#38bdf8] font-bold">Participants ({participants.length})</span>
                            <div className="flex gap-4 overflow-x-auto pb-2 px-1 no-scrollbar items-center">
                                {participants.map(p => {
                                    const isSpeaking = speakingUsers[p.id];
                                    const borderColor = isSpeaking ? (p.frameColor || '#38bdf8') : '#334155';
                                    
                                    return (
                                        <div key={p.id} className={cn("flex flex-col items-center gap-2 shrink-0 group", isSpeaking && "speaking")}>
                                            <div className="relative avatar-wrapper" style={{ '--color': p.frameColor || '#38bdf8' } as any}>
                                                <div 
                                                    onClick={() => setSelectedParticipant(selectedParticipant === p.id ? null : p.id)}
                                                    className={cn(
                                                        "avatar cursor-pointer w-14 h-14 md:w-16 md:h-16 rounded-full border-[3px] transition-all duration-300 flex items-center justify-center bg-[#0a0f1a] relative z-10",
                                                    )} 
                                                    style={{ 
                                                        borderColor,
                                                    } as any}
                                                >
                                                    {p.avatar ? (
                                                        <img src={p.avatar} alt={p.name} className="w-[calc(100%-6px)] h-[calc(100%-6px)] rounded-full object-cover" />
                                                    ) : (
                                                        <span className="text-xl font-bold" style={{ color: p.frameColor || '#cbd5e1' }}>{p.name.charAt(0).toUpperCase()}</span>
                                                    )}
                                                </div>
                                                {p.id === hostId && (
                                                    <div className="absolute -bottom-2 lg:-bottom-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-[9px] font-extrabold px-3 py-0.5 rounded-full border-[1.5px] border-[#161c2d] z-10 uppercase whitespace-nowrap shadow-sm tracking-wider">Host</div>
                                                )}
                                                {/* Admin Transfer Popup */}
                                                {selectedParticipant === p.id && isHost && p.id !== hostId && (
                                                    <div className="absolute top-full mt-3 left-1/2 -translate-x-1/2 z-50 bg-[#161c2d] border border-[#2e3c5a] shadow-xl rounded-xl p-2 w-max animate-in fade-in zoom-in duration-200">
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); transferAdmin(p.id); }}
                                                            className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-200 hover:text-white hover:bg-white/5 rounded-lg transition-colors whitespace-nowrap w-full"
                                                        >
                                                            <Crown className="w-4 h-4 text-cyan-400" />
                                                            Alihkan sebagai Admin
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-[11px] font-semibold text-slate-300 xl:text-[12px] truncate w-20 text-center mt-1">{p.name.split(' ')[0]}</div>
                                        </div>
                                    );
                                })}
                                {participants.length === 0 && (
                                    <div className="text-slate-500 text-xs italic opacity-50 py-4">Waiting to connect...</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            {/* Right Column: Chat (Bottom on Mobile) */}
            <div className="md:col-span-4 flex flex-col flex-1 overflow-hidden bg-transparent pb-4 md:pb-0 z-20">

                {/* Chat Panel */}
                <div className="flex-1 overflow-hidden relative flex flex-col md:bg-white/5 md:backdrop-blur-xl md:border md:border-white/10 md:rounded-[24px]">
                    {/* Header for Chat & Room Info (Mobile) */}
                    <div className="p-3 md:p-4 border-b border-white/5 flex items-center justify-between shadow-sm z-10 shrink-0 bg-transparent">
                        <span className="text-[10px] uppercase tracking-widest text-[#7dd3fc] font-bold">Live Chat</span>
                        <div className="md:hidden flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-[12px] border border-white/10">
                            <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", socketRef.current?.connected ? "bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.6)]" : "bg-red-500 animate-pulse")} />
                            <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest ml-0.5">Room:</span>
                            <span className="text-[11px] font-mono font-bold tracking-widest text-cyan-400">{roomId}</span>
                            <button onClick={copyRoomId} className="ml-1 text-slate-400 hover:text-white transition-colors active:scale-90">
                                <Copy className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-transparent">
                        {messages.map(msg => (
                            <div key={msg.id} className="flex gap-2 mb-3">
                                {msg.avatar ? (
                                    <div className="w-8 h-8 rounded-full p-[2px] shrink-0 mt-0.5" style={{ background: msg.frameColor || '#333' }}>
                                        <img src={msg.avatar} alt={msg.sender} className="w-[calc(100%-2px)] h-[calc(100%-2px)] rounded-full object-cover bg-black/50" />
                                    </div>
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center shrink-0 mt-0.5 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                                        <span className="text-[12px] text-cyan-400 font-bold">{msg.sender.charAt(0)}</span>
                                    </div>
                                )}
                                <div className="flex flex-col flex-1 min-w-0">
                                    <div className="flex items-baseline gap-2 mb-1 pl-1">
                                        <span className="text-[11px] font-bold text-slate-300 truncate">{msg.sender}</span>
                                        <span className="text-[9px] text-slate-600 font-mono shrink-0">{msg.time}</span>
                                    </div>
                                    <div className="bg-white/5 border border-cyan-500/20 rounded-2xl rounded-tl-sm p-3 w-fit max-w-[90%] shadow-[0_4px_15px_rgba(0,0,0,0.2)] relative group backdrop-blur-md">
                                        {msg.replyTo && (
                                            <div className="mb-2 pl-3 border-l-2 border-cyan-500/50 bg-black/20 p-2 rounded-r-lg">
                                                <p className="text-[10px] font-bold text-cyan-400 mb-0.5">{msg.replyTo.sender}</p>
                                                <p className="text-[11px] text-slate-400 truncate line-clamp-1 h-4 overflow-hidden">{msg.replyTo.text}</p>
                                            </div>
                                        )}
                                        <p className="text-[13px] text-slate-200 break-words leading-relaxed">{msg.text}</p>
                                        <button 
                                            onClick={() => setReplyingTo({ id: msg.id, sender: msg.sender, text: msg.text })}
                                            className="absolute -right-10 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-white/5 rounded-full"
                                            title="Reply"
                                        >
                                            <Reply className="w-4 h-4 text-slate-400" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>
                    
                    <div className="bg-transparent flex flex-col shrink-0 border-t border-white/5">
                        {replyingTo && (
                            <div className="px-4 py-2 flex items-center justify-between bg-white/5 border-b border-white/5 rounded-t-xl mb-1 mx-2 mt-2 backdrop-blur-xl">
                                <div className="flex flex-col flex-1 min-w-0 pr-2">
                                    <span className="text-[10px] text-cyan-400 font-bold mb-0.5">Replying to {replyingTo.sender}</span>
                                    <span className="text-xs text-slate-400 truncate">{replyingTo.text}</span>
                                </div>
                                <button onClick={() => setReplyingTo(null)} className="p-1 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                        <form onSubmit={handleSendChat} className="p-3 w-full flex gap-2 w-full">
                            <input 
                                type="text" 
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                placeholder="Message..."
                                className="flex-1 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 text-[13px] focus:outline-none focus:border-cyan-500/50 text-slate-200 placeholder:text-slate-500 shadow-inner"
                            />
                            <button 
                                type="submit"
                                disabled={!chatInput.trim()}
                                className="w-11 h-11 rounded-xl border flex items-center justify-center transition-colors disabled:opacity-50 border-cyan-500/30 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 shrink-0 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                            >
                                <Send className="w-4 h-4 ml-0.5" />
                            </button>
                        </form>
                    </div>
                </div>

            </div>
        </div>
        </div>
    );
}
