import React, {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  UploadCloud,
  FolderOpen,
} from "lucide-react";
import { cn } from "../lib/utils";

export interface LocalVideoPlayerProps {
  url: string;
  playing: boolean;
  controls: boolean;
  onPlay: () => void;
  onPause: () => void;
  onProgress: (state: { playedSeconds: number; played: number }) => void;
}

export const LocalVideoPlayer = forwardRef<any, LocalVideoPlayerProps>(
  ({ url, playing, controls, onPlay, onPause, onProgress }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const progressContainerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    useImperativeHandle(ref, () => ({
      seekTo: (amount: number, type?: string) => {
        if (videoRef.current) {
          if (type === "seconds") {
            videoRef.current.currentTime = amount;
          } else {
            videoRef.current.currentTime = amount * duration;
          }
        }
      },
      getCurrentTime: () => videoRef.current?.currentTime || 0,
      getDuration: () => videoRef.current?.duration || 0,
      getInternalPlayer: () => videoRef.current,
    }));

    useEffect(() => {
      if (videoRef.current) {
        if (playing) {
          // check if playing prevents error
          const playPromise = videoRef.current.play();
          if (playPromise !== undefined) {
            playPromise.catch((error) => {
              console.log("Autoplay prevented", error);
            });
          }
        } else {
          videoRef.current.pause();
        }
      }
    }, [playing, url]);

    const formatTime = (seconds: number) => {
      if (isNaN(seconds)) return "0:00";
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);

      if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
      }
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const togglePlay = () => {
      if (!controls) return;
      if (playing) {
        onPause();
      } else {
        onPlay();
      }
    };

    const handleTimeUpdate = () => {
      if (!videoRef.current || isDragging) return;
      setCurrentTime(videoRef.current.currentTime);
      onProgress({
        playedSeconds: videoRef.current.currentTime,
        played: duration ? videoRef.current.currentTime / duration : 0,
      });
    };

    const handleLoadedMetadata = () => {
      if (videoRef.current) {
        setDuration(videoRef.current.duration);
      }
    };

    const handleProgress = () => {
      if (videoRef.current && videoRef.current.buffered.length > 0) {
        const buff = videoRef.current.buffered.end(
          videoRef.current.buffered.length - 1,
        );
        setBuffered(buff);
      }
    };

    const handleSeek = (e: React.MouseEvent | MouseEvent) => {
      if (!controls || !progressContainerRef.current || !videoRef.current)
        return;
      const rect = progressContainerRef.current.getBoundingClientRect();
      let pos = (e.clientX - rect.left) / rect.width;
      pos = Math.max(0, Math.min(1, pos));

      videoRef.current.currentTime = pos * duration;
      setCurrentTime(pos * duration);
      onProgress({
        playedSeconds: pos * duration,
        played: pos,
      });
    };

    useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        if (isDragging) handleSeek(e);
      };
      const handleMouseUp = () => {
        setIsDragging(false);
      };

      if (isDragging) {
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
      }
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }, [isDragging, duration, controls]);

    const [showControls, setShowControls] = useState(true);
    let controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const resetControlsTimeout = () => {
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => {
        if (playing) setShowControls(false);
      }, 3000);
    };

    useEffect(() => {
      resetControlsTimeout();
      return () => {
        if (controlsTimeoutRef.current)
          clearTimeout(controlsTimeoutRef.current);
      };
    }, [playing]);

    const handleWrapperClick = () => {
      if (!controls) return;
      resetControlsTimeout();
    };

    const toggleFullscreen = () => {
      if (!wrapperRef.current) return;
      if (!document.fullscreenElement) {
        wrapperRef.current.requestFullscreen().catch((err) => {
          console.log("Fullscreen error:", err);
        });
      } else {
        document.exitFullscreen();
      }
    };

    const percent = duration ? (currentTime / duration) * 100 : 0;
    const bufferedPercent = duration ? (buffered / duration) * 100 : 0;

    return (
      <div
        ref={wrapperRef}
        className={cn(
          "custom-video-wrapper absolute inset-0 w-full h-full",
          (!playing || showControls) && "show-controls",
          !playing && "paused",
        )}
        onClick={handleWrapperClick}
        onMouseMove={resetControlsTimeout}
        onMouseLeave={() => playing && setShowControls(false)}
      >
        <video
          ref={videoRef}
          src={url}
          className="w-full h-full object-contain bg-black cursor-pointer"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onProgress={handleProgress}
          onEnded={onPause}
          onClick={togglePlay}
          playsInline
          muted={muted}
        />

        {controls && (
          <div
            className="video-overlay"
            onClick={togglePlay}
            style={{
              opacity: playing ? 0 : "",
              pointerEvents: playing ? "none" : "auto",
            }}
          >
            <div className="overlay-play-btn">
              <Play className="w-10 h-10 ml-1 text-white fill-white" />
            </div>
          </div>
        )}

        {controls && (
          <div className="custom-controls" onClick={(e) => e.stopPropagation()}>
            {/* Progress Bar */}
            <div
              className="progress-container"
              ref={progressContainerRef}
              onClick={handleSeek}
              onMouseDown={() => setIsDragging(true)}
            >
              <div
                className="progress-buffered"
                style={{ width: `${bufferedPercent}%` }}
              ></div>
              <div
                className="progress-bar-fill"
                style={{ width: `${percent}%` }}
              ></div>
            </div>

            {/* Controls Row */}
            <div className="controls-row">
              <div className="controls-left">
                <button
                  className="ctrl-btn play-btn"
                  onClick={togglePlay}
                  title="Play / Pause"
                >
                  {playing ? (
                    <Pause className="w-6 h-6 fill-white" />
                  ) : (
                    <Play className="w-6 h-6 fill-white" />
                  )}
                </button>

                <div className="volume-group ml-2">
                  <button
                    className="ctrl-btn p-1"
                    onClick={() => setMuted(!muted)}
                    title="Mute"
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="w-5 h-5" />
                    ) : (
                      <Volume2 className="w-5 h-5" />
                    )}
                  </button>
                  <input
                    type="range"
                    className="volume-slider"
                    min="0"
                    max="1"
                    step="0.01"
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setVolume(v);
                      setMuted(v === 0);
                      if (videoRef.current) videoRef.current.volume = v;
                    }}
                  />
                </div>

                <div className="time-display">
                  <span className="current">{formatTime(currentTime)}</span>
                  <span> / </span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="controls-right">
                <button
                  className="ctrl-btn"
                  onClick={toggleFullscreen}
                  title="Fullscreen"
                >
                  <Maximize className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);
