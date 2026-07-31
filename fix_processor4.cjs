const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/engine/processor.ts', 'utf8');

const searchLoop = `        async function* getSamples() {
            yield firstSample;
            for await (const sample of sink.samples()) {
                yield sample;
            }
        }`;

const replaceLoop = `        async function* getSamples() {
            yield firstSample;
            while (true) {
                const res = await sampleIterator.next();
                if (res.done) break;
                yield res.value;
            }
        }`;

code = code.replace(searchLoop, replaceLoop);

fs.writeFileSync('/app/applet/src/engine/processor.ts', code);
