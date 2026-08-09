import React, { useState, useRef } from 'react';
import { Upload, Download, Loader2, Settings2, ChevronDown, Trash2, Plus, CheckCircle2, Play } from 'lucide-react';
import { VideoWatermarkAndUpscaleEngine, VIDEO_DEFAULTS } from './engine/processor';

interface VideoTask {
  id: string;
  file: File;
  progress: number;
  status: string | null;
  resultUrl: string | null;
  error: string | null;
  isProcessing: boolean;
  isComplete: boolean;
}

export default function App() {
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  
  // Settings state
  const [gain, setGain] = useState(VIDEO_DEFAULTS.gain);
  const [sizeScale, setSizeScale] = useState(VIDEO_DEFAULTS.sizeScale);
  const [offsetX, setOffsetX] = useState(VIDEO_DEFAULTS.offsetX);
  const [offsetY, setOffsetY] = useState(VIDEO_DEFAULTS.offsetY);
  const [resolutionMode, setResolutionMode] = useState('1080p');
  const [showSettings, setShowSettings] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (newFiles: FileList | File[]) => {
    const videoFiles = Array.from(newFiles).filter(f => f.type.startsWith('video/'));
    const newTasks: VideoTask[] = videoFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      progress: 0,
      status: null,
      resultUrl: null,
      error: null,
      isProcessing: false,
      isComplete: false
    }));
    setTasks(prev => [...prev, ...newTasks]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const removeTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const updateTask = (id: string, updates: Partial<VideoTask>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const processBatch = async () => {
    setIsBatchProcessing(true);
    
    try {
      if (!VideoWatermarkAndUpscaleEngine.isSupported()) {
        throw new Error('Your browser does not support the required WebCodecs APIs.');
      }
      
      const engine = await VideoWatermarkAndUpscaleEngine.create();
      
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        if (task.isComplete || task.isProcessing) continue;
        
        updateTask(task.id, { isProcessing: true, error: null, progress: 0, status: 'Starting...' });
        
        try {
          const result = await engine.process(task.file, {
            gain,
            sizeScale,
            offsetX,
            offsetY,
            resolutionMode,
            onProgress: (p: any) => {
              const progress = Math.round(p.progress * 100);
              let status = p.status || 'Processing...';
              if (p.status && p.currentFrame !== undefined) {
                status = `${p.status} - Frame ${p.currentFrame} of ${p.totalFrames}`;
              }
              updateTask(task.id, { progress, status });
            }
          });
          
          updateTask(task.id, {
            isProcessing: false,
            isComplete: true,
            resultUrl: result.url,
            status: 'Complete',
            progress: 100
          });
        } catch (err: any) {
          console.error(`Error processing ${task.file.name}:`, err);
          updateTask(task.id, {
            isProcessing: false,
            error: err.message || 'An error occurred',
            status: 'Failed'
          });
        }
      }
    } catch (err: any) {
      alert(err.message || 'Fatal error initializing engine');
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const hasPendingTasks = tasks.some(t => !t.isComplete && !t.isProcessing && !t.error);

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col items-center p-4 py-12">
      <div className="max-w-2xl w-full bg-neutral-800 rounded-2xl shadow-xl overflow-hidden border border-neutral-700">
        <div className="p-8">
          <h1 className="text-2xl font-semibold mb-2">Clean & Upscale</h1>
          <p className="text-neutral-400 mb-8">
            Automatically remove the Gemini watermark and upscale your videos using AI. Batch processing supported.
          </p>

          <div
            className="border-2 border-dashed border-neutral-600 rounded-xl p-8 mb-8 text-center cursor-pointer hover:border-blue-500 hover:bg-neutral-700/30 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <Upload className="w-10 h-10 mx-auto text-neutral-400 mb-4" />
            <p className="text-base font-medium">Click or drag videos here</p>
            <p className="text-sm text-neutral-500 mt-2">MP4, WebM, MOV</p>
          </div>
          
          <input
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
          />

          {tasks.length > 0 && (
            <div className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-medium">Queue ({tasks.length})</h2>
                  {tasks.some(t => t.isComplete) && !isBatchProcessing && (
                     <button 
                       onClick={() => setTasks(tasks.filter(t => !t.isComplete))}
                       className="text-sm text-neutral-400 hover:text-white"
                     >
                       Clear Completed
                     </button>
                  )}
                </div>
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <div key={task.id} className="bg-neutral-900 rounded-xl p-4 border border-neutral-700 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="truncate flex-1 font-medium text-sm pr-4">{task.file.name}</span>
                        {!task.isProcessing && !task.isComplete && (
                          <button
                            onClick={() => removeTask(task.id)}
                            className="text-neutral-500 hover:text-red-400 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        {task.isComplete && (
                          <CheckCircle2 className="w-5 h-5 text-green-500" />
                        )}
                      </div>
                      
                      {task.isProcessing && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-blue-400 truncate max-w-[200px]">{task.status}</span>
                            <span>{task.progress}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 transition-all duration-300 ease-out"
                              style={{ width: `${task.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      
                      {task.error && (
                        <div className="text-xs text-red-400 bg-red-400/10 p-2 rounded-lg">
                          Error: {task.error}
                        </div>
                      )}
                      
                      {task.isComplete && task.resultUrl && (
                        <div className="flex items-center gap-3 pt-2 border-t border-neutral-800">
                           <video 
                             src={task.resultUrl} 
                             className="w-20 h-20 object-cover rounded-lg bg-black" 
                             controls
                             preload="metadata"
                           />
                           <a
                             href={task.resultUrl}
                             download={`cleaned_${task.file.name}`}
                             className="flex-1 flex items-center justify-center py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm font-medium transition-colors"
                           >
                             <Download className="w-4 h-4 mr-2" />
                             Download
                           </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {!isBatchProcessing && hasPendingTasks && (
                <div className="pt-6 border-t border-neutral-800 space-y-4">
                  <div className="bg-neutral-900 p-4 rounded-xl space-y-2 border border-neutral-700">
                    <label className="text-sm font-medium text-neutral-300">Output Resolution</label>
                    <div className="relative">
                      <select
                        value={resolutionMode}
                        onChange={(e) => setResolutionMode(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-neutral-100 outline-none focus:border-blue-500 transition-colors appearance-none"
                      >
                        <option value="1080p">1080 × 1920 (Vertical 1080p)</option>
                        <option value="2k">2x Upscale (Previous 2K)</option>
                      </select>
                      <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-neutral-400">
                        <ChevronDown className="w-5 h-5" />
                      </div>
                    </div>
                  </div>
                  
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
                    onClick={processBatch}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-medium text-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    Process {tasks.filter(t => !t.isComplete && !t.isProcessing && !t.error).length} Videos
                  </button>
                </div>
              )}
              
              {isBatchProcessing && (
                <div className="pt-6 border-t border-neutral-800 text-center space-y-2">
                   <div className="flex items-center justify-center text-sm text-neutral-400">
                     <Loader2 className="w-4 h-4 animate-spin mr-2" />
                     Processing batch... Please keep this tab open.
                   </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
