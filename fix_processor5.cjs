const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/engine/processor.ts', 'utf8');

const search = `        const fallbackDur = frameRate > 0 ? 1 / frameRate : 1 / 30;
        const sink = new VideoSampleSink(videoTrack);

        let firstTimestamp: number | null = null;`;

const replace = `        const fallbackDur = frameRate > 0 ? 1 / frameRate : 1 / 30;

        let firstTimestamp: number | null = null;`;

code = code.replace(search, replace);

fs.writeFileSync('/app/applet/src/engine/processor.ts', code);
