const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/App.tsx', 'utf8');

// Add status state
code = code.replace(
    'const [progress, setProgress] = useState(0);',
    'const [progress, setProgress] = useState(0);\n  const [status, setStatus] = useState<string | null>(null);'
);

// Update progress handling
code = code.replace(
    'setProgress(Math.round(p.progress * 100));',
    'setProgress(Math.round(p.progress * 100));\n          if (p.status && p.currentFrame !== undefined) {\n            setStatus(`${p.status} - Frame ${p.currentFrame} of ${p.totalFrames}`);\n          }'
);

// Add process another video button
const processAnotherBtn = `
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
`;

code = code.replace(
    'Download Video\n                  </a>',
    'Download Video\n                  </a>' + processAnotherBtn
);

// Update progress UI
const processingUI = `{isProcessing && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-blue-400 font-medium">{status || 'Processing...'}</span>
                    <span className="font-medium">{progress}%</span>
                  </div>
                  <div className="h-2 w-full bg-neutral-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300 ease-out"
                      style={{ width: \`\${progress}%\` }}
                    />
                  </div>
                  <div className="flex items-center justify-center text-sm text-neutral-400 pt-2">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    This runs entirely in your browser. Large files will take a while.
                  </div>
                </div>
              )}`;

code = code.replace(/\{isProcessing && \([\s\S]*?This runs entirely in your browser and may take a while\.[\s\S]*?\}\)/, processingUI);

fs.writeFileSync('/app/applet/src/App.tsx', code);
