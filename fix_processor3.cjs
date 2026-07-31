const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/engine/processor.ts', 'utf8');

code = code.replace(/videoSink/g, 'sink');
// Remove the second 'const sink = new VideoSampleSink(videoTrack);'
code = code.replace(/const sink = new VideoSampleSink\(videoTrack\);\n        let firstTimestamp/g, 'let firstTimestamp');

fs.writeFileSync('/app/applet/src/engine/processor.ts', code);
