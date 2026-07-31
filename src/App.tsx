import React, { useState, useRef } from 'react';
import { Upload, Download, Loader2, Settings2 } from 'lucide-react';
import { VideoWatermarkAndUpscaleEngine, VIDEO_DEFAULTS } from './engine/processor';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Settings state
  const [gain, setGain] = useState(VIDEO_DEFAULTS.gain);
  const [sizeScale, setSizeScale] = useState(VIDEO_DEFAULTS.sizeScale);
  const [offsetX, setOffsetX] = useState(VIDEO_DEFAULTS.offsetX);
  const [offsetY, setOffsetY] = useState(VIDEO_DEFAULTS.offsetY);
  const [showSettings, setShowSettings] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setResultUrl(null);
      setError(null);
      setProgress(0);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type.startsWith('video/')) {
        setFile(droppedFile);
        setResultUrl(null);
        setError(null);
        setProgress(0);
      }
    }
  };

  const handleProcess = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setProgress(0);

    try {
      if (!VideoWatermarkAndUpscaleEngine.isSupported()) {
        throw new Error('Your browser does not support the required WebCodecs APIs.');
      }

      const engine = await VideoWatermarkAndUpscaleEngine.create();
      const result = await engine.process(file, {
        gain,
        sizeScale,
        offsetX,
        offsetY,
        onProgress: (p: any) => {
          setProgress(Math.round(p.progress * 100));
          if (p.status && p.currentFrame !== undefined) {
            setStatus(`${p.status} - Frame ${p.currentFrame} of ${p.totalFrames}`);
          }
        }
      });

      setResultUrl(result.url);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during processing.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col items-center justify-center p-4">
      <div className="max-w-xl w-full bg-neutral-800 rounded-2xl shadow-xl overflow-hidden border border-neutral-700">
        <div className="p-8">
          <h1 className="text-2xl font-semibold mb-2">Clean & Upscale</h1>
          <p className="text-neutral-400 mb-8">
            Automatically remove the Gemini watermark and upscale your video using AI.
          </p>

          {!file ? (
            <div
              className="border-2 border-dashed border-neutral-600 rounded-xl p-12 text-center cursor-pointer hover:border-blue-500 hover:bg-neutral-700/30 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <Upload className="w-12 h-12 mx-auto text-neutral-400 mb-4" />
              <p className="text-lg font-medium">Click or drag a video to upload</p>
              <p className="text-sm text-neutral-500 mt-2">MP4, WebM, MOV</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-neutral-900 rounded-xl p-4 flex items-center justify-between">
                <span className="truncate flex-1 font-medium">{file.name}</span>
                {!isProcessing && !resultUrl && (
                  <button
                    onClick={() => {
                      setFile(null);
                      setResultUrl(null);
                    }}
                    className="text-sm text-red-400 hover:text-red-300 ml-4"
                  >
                    Change
                  </button>
                )}
              </div>

              {!resultUrl && !isProcessing && (
                <div className="space-y-4">
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="flex items-center text-sm text-neutral-400 hover:text-white transition-colors"
                  >
                    <Settings2 className="w-4 h-4 mr-2" />
                    {showSettings ? 'Hide Settings' : 'Tune Watermark Settings'}
                  </button>

                  {showSettings && (
                    <div className="bg-neutral-900 p-4 rounded-xl space-y-4 border border-neutral-700">
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <label className="text-neutral-300">Strength</label>
                          <span className="text-neutral-400">{gain.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.01"
                          value={gain}
                          onChange={(e) => setGain(parseFloat(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <label className="text-neutral-300">Size</label>
                          <span className="text-neutral-400">{sizeScale.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2"
                          step="0.01"
                          value={sizeScale}
                          onChange={(e) => setSizeScale(parseFloat(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <label className="text-neutral-300">Position X</label>
                          <span className="text-neutral-400">{offsetX}px</span>
                        </div>
                        <input
                          type="range"
                          min="-100"
                          max="100"
                          step="1"
                          value={offsetX}
                          onChange={(e) => setOffsetX(parseInt(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <label className="text-neutral-300">Position Y</label>
                          <span className="text-neutral-400">{offsetY}px</span>
                        </div>
                        <input
                          type="range"
                          min="-100"
                          max="100"
                          step="1"
                          value={offsetY}
                          onChange={(e) => setOffsetY(parseInt(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                      </div>
                      <div className="pt-2 flex justify-end">
                        <button
                          onClick={() => {
                            setGain(VIDEO_DEFAULTS.gain);
                            setSizeScale(VIDEO_DEFAULTS.sizeScale);
                            setOffsetX(VIDEO_DEFAULTS.offsetX);
                            setOffsetY(VIDEO_DEFAULTS.offsetY);
                          }}
                          className="text-xs text-neutral-400 hover:text-white"
                        >
                          Reset to Defaults
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleProcess}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-medium text-lg transition-colors"
                  >
                    Process Video
                  </button>
                </div>
              )}

              {isProcessing && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-blue-400 font-medium">{status || 'Processing...'}</span>
                    <span className="font-medium">{progress}%</span>
                  </div>
                  <div className="h-2 w-full bg-neutral-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-center text-sm text-neutral-400 pt-2">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    This runs entirely in your browser. Large files will take a while.
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm">
                  {error}
                </div>
              )}

              {resultUrl && (
                <div className="space-y-6 pt-4 border-t border-neutral-700">
                  <h3 className="font-medium text-lg text-green-400">Processing Complete!</h3>
                  <video
                    src={resultUrl}
                    controls
                    className="w-full rounded-xl bg-black"
                  />
                  <a
                    href={resultUrl}
                    download={`cleaned_upscaled_${file.name}`}
                    className="w-full flex items-center justify-center py-4 bg-white text-black hover:bg-neutral-200 rounded-xl font-medium text-lg transition-colors"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Download Video
                  </a>
                  <button
                    onClick={() => {
                      setFile(null);
                      setResultUrl(null);
                      setProgress(0);
                      setStatus(null);
                      setError(null);
                    }}
                    className="w-full py-4 bg-transparent border-2 border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800 rounded-xl font-medium text-lg transition-colors"
                  >
                    Process Another Video
                  </button>

                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <input
        type="file"
        accept="video/*"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />
    </div>
  );
}
