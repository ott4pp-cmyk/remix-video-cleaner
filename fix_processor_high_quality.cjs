const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/engine/processor.ts', 'utf8');

code = code.replace("import weights from '../weights/cnn-2x-m-rl.json';", "import weights from '../weights/cnn-2x-l-rl.json';");
code = code.replace('network_name: "anime4k/cnn-2x-m"', 'network_name: "anime4k/cnn-2x-l"');

code = code.replace(
    'onProgress({ progress: Math.min(1, timestamp / duration) });',
    'const currentFrame = Math.round(timestamp * frameRate);\n                const totalFrames = Math.round(duration * frameRate);\n                onProgress({ progress: Math.min(1, timestamp / duration), currentFrame, totalFrames, status: "Removing Watermark & Upscaling" });'
);

fs.writeFileSync('/app/applet/src/engine/processor.ts', code);
