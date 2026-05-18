import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useStore } from './useStore';

export function useSocket(roomId: string | undefined) {
    const socketRef = useRef<Socket | null>(null);
    const profile = useStore(state => state.profile);

    useEffect(() => {
        if (!roomId || !profile) return;

        const url = import.meta.env.VITE_APP_URL || window.location.origin;
        const socket = io(url);
        socketRef.current = socket;

        socket.on('connect', () => {
            socket.emit('join-room', { roomId, user: profile });
        });

        return () => {
            socket.disconnect();
        };
    }, [roomId, profile]);

    return socketRef;
}
