import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  Download,
  SlidersHorizontal,
  Trash2,
  Check,
  Film,
  Image as ImageIcon,
  RotateCcw,
  FolderArchive,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { VideoWatermarkEngine, VIDEO_DEFAULTS, ProcessResult } from './engine/processor';
import { zipStore } from './engine/videotoframes';

interface VideoJob {
  id: string;
  file: File;
  progress: number;
  status: string;
  result: ProcessResult | null;
  error: string | null;
  state: 'queued' | 'processing' | 'done' | 'error';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function triggerFileDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function triggerDualDownload(result: ProcessResult) {
  triggerFileDownload(result.url, result.videoFileName);
  setTimeout(() => {
    triggerFileDownload(result.finalFrame.url, result.finalFrame.name);
  }, 350);
}

export default function App() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [autoDownload, setAutoDownload] = useState(true);
  const [autoDetect, setAutoDetect] = useState(true);
  const [showTuner, setShowTuner] = useState(false);

  // Manual calibration controls
  const [gain, setGain] = useState(VIDEO_DEFAULTS.gain);
  const [sizeScale, setSizeScale] = useState(VIDEO_DEFAULTS.sizeScale);
  const [offsetX, setOffsetX] = useState(VIDEO_DEFAULTS.offsetX);
  const [offsetY, setOffsetY] = useState(VIDEO_DEFAULTS.offsetY);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isProcessingRef = useRef(false);
  const engineRef = useRef<VideoWatermarkEngine | null>(null);

  const settingsRef = useRef({
    autoDownload,
    autoDetect,
    gain,
    sizeScale,
    offsetX,
    offsetY,
  });

  useEffect(() => {
    settingsRef.current = {
      autoDownload,
      autoDetect,
      gain,
      sizeScale,
      offsetX,
      offsetY,
    };
  }, [autoDownload, autoDetect, gain, sizeScale, offsetX, offsetY]);

  const updateJob = useCallback((id: string, patch: Partial<VideoJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const runQueue = useCallback(async (currentJobs: VideoJob[]) => {
    if (isProcessingRef.current) return;
    const nextJob = currentJobs.find((j) => j.state === 'queued');
    if (!nextJob) return;

    isProcessingRef.current = true;
    updateJob(nextJob.id, { state: 'processing', progress: 2, status: 'Initializing...' });

    try {
      if (!VideoWatermarkEngine.isSupported()) {
        throw new Error('WebCodecs API not supported in this browser. Use Chrome or Edge.');
      }

      if (!engineRef.current) {
        engineRef.current = await VideoWatermarkEngine.create();
      }

      const cfg = settingsRef.current;
      const result = await engineRef.current.process(nextJob.file, {
        autoDetect: cfg.autoDetect,
        gain: cfg.gain,
        sizeScale: cfg.sizeScale,
        offsetX: cfg.offsetX,
        offsetY: cfg.offsetY,
        onProgress: (p: { progress: number; status?: string }) => {
          updateJob(nextJob.id, {
            progress: Math.max(2, Math.round(p.progress * 100)),
            status: p.status || 'Processing...',
          });
        },
      });

      updateJob(nextJob.id, {
        state: 'done',
        progress: 100,
        status: 'Exported',
        result,
        error: null,
      });

      if (settingsRef.current.autoDownload) {
        triggerDualDownload(result);
      }
    } catch (err: any) {
      updateJob(nextJob.id, {
        state: 'error',
        error: err?.message || 'Processing failed',
        status: 'Failed',
      });
    } finally {
      isProcessingRef.current = false;
    }
  }, [updateJob]);

  useEffect(() => {
    if (jobs.some((j) => j.state === 'queued') && !isProcessingRef.current) {
      runQueue(jobs);
    }
  }, [jobs, runQueue]);

  const enqueueFiles = (fileList: FileList | File[]) => {
    const videos = Array.from(fileList).filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(f.name));
    if (!videos.length) return;

    const newJobs: VideoJob[] = videos.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      progress: 0,
      status: 'Queued',
      result: null,
      error: null,
      state: 'queued',
    }));

    setJobs((prev) => [...newJobs, ...prev]);
  };

  const reprocessJob = (job: VideoJob) => {
    if (job.result) {
      URL.revokeObjectURL(job.result.url);
      URL.revokeObjectURL(job.result.finalFrame.url);
    }
    updateJob(job.id, {
      state: 'queued',
      progress: 0,
      status: 'Queued',
      result: null,
      error: null,
    });
  };

  const removeJob = (id: string) => {
    setJobs((prev) => {
      const target = prev.find((j) => j.id === id);
      if (target?.result) {
        URL.revokeObjectURL(target.result.url);
        URL.revokeObjectURL(target.result.finalFrame.url);
      }
      return prev.filter((j) => j.id !== id);
    });
  };

  const clearAll = () => {
    jobs.forEach((j) => {
      if (j.result) {
        URL.revokeObjectURL(j.result.url);
        URL.revokeObjectURL(j.result.finalFrame.url);
      }
    });
    setJobs([]);
  };

  const downloadZip = async (result: ProcessResult) => {
    const [videoBuf, frameBuf] = await Promise.all([
      result.blob.arrayBuffer(),
      result.finalFrame.blob.arrayBuffer(),
    ]);
    const zipBlob = zipStore([
      { name: result.videoFileName, data: new Uint8Array(videoBuf) },
      { name: result.finalFrame.name, data: new Uint8Array(frameBuf) },
    ]);
    const zipUrl = URL.createObjectURL(zipBlob);
    const base = result.videoFileName.replace(/_clean\.mp4$/, '');
    triggerFileDownload(zipUrl, `${base}_bundle.zip`);
    setTimeout(() => URL.revokeObjectURL(zipUrl), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0B0D13] text-[#F1F5F9] flex flex-col">
      {/* Top Bar Contract: 3 zones */}
      <header className="flex items-center justify-between gap-8 px-6 lg:px-12 py-4 border-b border-[#1E2330] bg-[#0B0D13]/90 backdrop-blur-md sticky top-0 z-20">
        <a
          href="#workspace"
          className="text-lg font-semibold tracking-tight text-white whitespace-nowrap shrink-0 font-display"
        >
          Remix Studio
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <a
            href="#workspace"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Workspace
          </a>
          <button
            type="button"
            onClick={() => setShowTuner((v) => !v)}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Calibration
          </button>
          <a
            href="#outputs"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Outputs ({jobs.length})
          </a>
          <button
            type="button"
            onClick={() => setAutoDownload((v) => !v)}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Auto-Download: {autoDownload ? 'On' : 'Off'}
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-2"
          >
            <Upload className="w-3.5 h-3.5" />
            Select Video
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main id="workspace" className="flex-1 w-full max-w-[1280px] mx-auto px-6 lg:px-12 py-8 space-y-8">
        {/* Drop Stage & Controls */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Primary Drop Target */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files?.length) {
                enqueueFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`lg:col-span-8 rounded-2xl border transition-all duration-150 p-8 flex flex-col justify-between cursor-pointer min-h-[220px] ${
              isDragging
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-[#1E2330] bg-[#111520] hover:border-slate-700 hover:bg-[#141926]'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white font-display">
                  Drop video to clean &amp; extract final frame
                </h1>
                <p className="text-sm text-slate-400">
                  Original resolution MP4 + Lossless PNG last frame · Auto-downloads both files
                </p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                <Upload className="w-5 h-5" />
              </div>
            </div>

            <div className="pt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[#1E2330]/80 mt-6 text-xs text-slate-400 font-mono tabular-nums">
              <div className="flex items-center gap-3">
                <span>01. Watermark Removal (1:1 Original)</span>
                <span aria-hidden="true">·</span>
                <span>02. Final Frame (Lossless PNG)</span>
              </div>
              <span className="text-blue-400 font-sans font-medium">
                Click or drop MP4 / MOV / WebM
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  enqueueFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Compact Pipeline & Calibration Panel */}
          <div className="lg:col-span-4 rounded-2xl border border-[#1E2330] bg-[#111520] p-6 flex flex-col justify-between gap-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white font-display">
                  Export Configuration
                </span>
                <button
                  type="button"
                  onClick={() => setShowTuner((v) => !v)}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {showTuner ? 'Hide Tuner' : 'Fine-Tune'}
                </button>
              </div>

              {/* Segmented Mode Control */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-[#0B0D13] rounded-lg border border-[#1E2330]">
                <button
                  type="button"
                  onClick={() => setAutoDetect(true)}
                  className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    autoDetect
                      ? 'bg-[#1E2330] text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Auto-Detect
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoDetect(false);
                    setShowTuner(true);
                  }}
                  className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    !autoDetect
                      ? 'bg-[#1E2330] text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Manual Box
                </button>
              </div>

              {/* Auto-Download Toggle */}
              <label className="flex items-center justify-between pt-1 cursor-pointer select-none">
                <span className="text-xs text-slate-300">Auto-download 2 files on finish</span>
                <input
                  type="checkbox"
                  checked={autoDownload}
                  onChange={(e) => setAutoDownload(e.target.checked)}
                  className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                />
              </label>
            </div>

            <div className="pt-4 border-t border-[#1E2330] flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
              <span>Scale: 1:1 Native</span>
              <span>Frame: PNG Lossless</span>
            </div>
          </div>
        </section>

        {/* Collapsible Manual Watermark Tuner */}
        {showTuner && (
          <section className="rounded-2xl border border-[#1E2330] bg-[#111520] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white font-display">
                Manual Watermark Calibration
              </h2>
              <button
                type="button"
                onClick={() => {
                  setGain(VIDEO_DEFAULTS.gain);
                  setSizeScale(VIDEO_DEFAULTS.sizeScale);
                  setOffsetX(VIDEO_DEFAULTS.offsetX);
                  setOffsetY(VIDEO_DEFAULTS.offsetY);
                }}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Defaults
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-2">
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Alpha Gain</span>
                  <span className="font-mono tabular-nums text-white">{gain.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.5"
                  step="0.02"
                  value={gain}
                  onChange={(e) => {
                    setAutoDetect(false);
                    setGain(parseFloat(e.target.value));
                  }}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Template Scale</span>
                  <span className="font-mono tabular-nums text-white">{sizeScale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.02"
                  value={sizeScale}
                  onChange={(e) => {
                    setAutoDetect(false);
                    setSizeScale(parseFloat(e.target.value));
                  }}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Offset X</span>
                  <span className="font-mono tabular-nums text-white">{offsetX}px</span>
                </div>
                <input
                  type="range"
                  min="-160"
                  max="60"
                  step="1"
                  value={offsetX}
                  onChange={(e) => {
                    setAutoDetect(false);
                    setOffsetX(parseInt(e.target.value, 10));
                  }}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Offset Y</span>
                  <span className="font-mono tabular-nums text-white">{offsetY}px</span>
                </div>
                <input
                  type="range"
                  min="-160"
                  max="60"
                  step="1"
                  value={offsetY}
                  onChange={(e) => {
                    setAutoDetect(false);
                    setOffsetY(parseInt(e.target.value, 10));
                  }}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>
            </div>
          </section>
        )}

        {/* Output Queue */}
        <section id="outputs" className="space-y-4">
          {jobs.length > 0 && (
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white font-display">
                Processed Outputs ({jobs.length})
              </h2>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
              >
                Clear All
              </button>
            </div>
          )}

          <div className="space-y-6">
            {jobs.map((job) => (
              <article
                key={job.id}
                className="rounded-2xl border border-[#1E2330] bg-[#111520] overflow-hidden"
              >
                {/* Job Header */}
                <div className="px-6 py-4 border-b border-[#1E2330] flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {job.state === 'processing' && (
                      <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                    )}
                    {job.state === 'done' && (
                      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                    {job.state === 'error' && (
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <span className="text-sm font-medium text-white truncate">
                      {job.file.name}
                    </span>
                    <span className="text-xs text-slate-500 font-mono tabular-nums shrink-0">
                      {formatBytes(job.file.size)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {job.result && (
                      <>
                        <button
                          type="button"
                          onClick={() => triggerDualDownload(job.result!)}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download Both
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadZip(job.result!)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#1A2030] hover:bg-[#232B3E] rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <FolderArchive className="w-3.5 h-3.5" />
                          ZIP
                        </button>
                      </>
                    )}
                    {(job.state === 'done' || job.state === 'error') && (
                      <button
                        type="button"
                        onClick={() => reprocessJob(job)}
                        title="Re-process with current settings"
                        className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-[#1A2030] transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeJob(job.id)}
                      title="Remove"
                      className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-[#1A2030] transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Progress State */}
                {(job.state === 'processing' || job.state === 'queued') && (
                  <div className="p-6 space-y-3">
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className="text-slate-300">{job.status}</span>
                      <span className="text-blue-400">{job.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-[#0B0D13] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-transform duration-150 origin-left"
                        style={{ transform: `scaleX(${job.progress / 100})` }}
                      />
                    </div>
                  </div>
                )}

                {/* Error State */}
                {job.state === 'error' && (
                  <div className="p-6 text-xs text-red-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{job.error}</span>
                  </div>
                )}

                {/* Completed Dual Output View */}
                {job.state === 'done' && job.result && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#1E2330]">
                    {/* Output 1: Watermark-Free Video (Original Size) */}
                    <div className="p-6 flex flex-col justify-between gap-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                          <Film className="w-4 h-4 text-blue-400" />
                          <span>Watermark-Free Video</span>
                        </div>
                        <span className="text-xs text-slate-400 font-mono tabular-nums">
                          {job.result.width} × {job.result.height} · MP4 · {formatBytes(job.result.blob.size)}
                        </span>
                      </div>

                      <div className="rounded-xl overflow-hidden bg-black border border-[#1E2330] aspect-video flex items-center justify-center">
                        <video
                          src={job.result.url}
                          controls
                          playsInline
                          preload="metadata"
                          className="max-h-[320px] w-full h-full object-contain"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-4 pt-1">
                        <span className="text-xs text-slate-500 font-mono truncate">
                          {job.result.videoFileName}
                        </span>
                        <a
                          href={job.result.url}
                          download={job.result.videoFileName}
                          className="px-3.5 py-2 text-xs font-medium text-white bg-[#1A2030] hover:bg-[#232B3E] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Save MP4
                        </a>
                      </div>
                    </div>

                    {/* Output 2: Final Frame (Lossless PNG) */}
                    <div className="p-6 flex flex-col justify-between gap-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                          <ImageIcon className="w-4 h-4 text-emerald-400" />
                          <span>Final Frame (Lossless PNG)</span>
                        </div>
                        <span className="text-xs text-slate-400 font-mono tabular-nums">
                          {job.result.finalFrame.width} × {job.result.finalFrame.height} · PNG ·{' '}
                          {formatBytes(job.result.finalFrame.blob.size)}
                        </span>
                      </div>

                      <div className="rounded-xl overflow-hidden bg-black border border-[#1E2330] aspect-video flex items-center justify-center">
                        <img
                          src={job.result.finalFrame.url}
                          alt={job.result.finalFrame.name}
                          referrerPolicy="no-referrer"
                          className="max-h-[320px] w-full h-full object-contain"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-4 pt-1">
                        <span className="text-xs text-slate-500 font-mono truncate">
                          {job.result.finalFrame.name}
                        </span>
                        <a
                          href={job.result.finalFrame.url}
                          download={job.result.finalFrame.name}
                          className="px-3.5 py-2 text-xs font-medium text-white bg-[#1A2030] hover:bg-[#232B3E] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Save PNG
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
