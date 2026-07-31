const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/App.tsx', 'utf8');

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

const search = `{isProcessing && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span>Processing...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 w-full bg-neutral-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300 ease-out"
                      style={{ width: \`\${progress}%\` }}
                    />
                  </div>
                  <div className="flex items-center justify-center text-sm text-neutral-400 pt-2">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    This runs entirely in your browser and may take a while.
                  </div>
                </div>
              )}`;

code = code.replace(search, processingUI);
fs.writeFileSync('/app/applet/src/App.tsx', code);
