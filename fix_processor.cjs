const fs = require('fs');
let code = fs.readFileSync('/app/applet/src/engine/processor.ts', 'utf8');

// Find the block where width and height are extracted and replace it.
const searchBlock = `        const width = (await videoTrack.getDisplayWidth()) ?? (await videoTrack.getCodedWidth());
        const height = (await videoTrack.getDisplayHeight()) ?? (await videoTrack.getCodedHeight());
        const duration = await input.computeDuration().catch(() => 0);
        if (!width || !height) throw new Error("Could not resolve video dimensions."); console.log("Resolved dims:", width, height);`;

const replaceBlock = `        const duration = await input.computeDuration().catch(() => 0);
        
        // Extract dimensions from the first decoded sample to be absolutely certain
        const sink = new VideoSampleSink(videoTrack);
        const sampleIterator = sink.samples()[Symbol.asyncIterator]();
        const firstSampleResult = await sampleIterator.next();
        if (firstSampleResult.done) {
            throw new Error("No video frames could be decoded.");
        }
        const firstSample = firstSampleResult.value;
        const width = firstSample.displayWidth || firstSample.codedWidth;
        const height = firstSample.displayHeight || firstSample.codedHeight;
        if (!width || !height) {
            throw new Error("Could not resolve video dimensions from the first frame.");
        }`;

code = code.replace(searchBlock, replaceBlock);

// Now we must ensure `firstSample` is processed first in the loop!
// But wait, the loop is `for await (const sample of sink.samples())`.
// If we already pulled the first sample, the loop will miss it!
// Let's replace the `for await (const sample of sink.samples()) {` with a while loop or an array of samples.
// It's easier to create a helper async generator.
const searchLoop = `        for await (const sample of sink.samples()) {`;
const replaceLoop = `        async function* getSamples() {
            yield firstSample;
            for await (const sample of sink.samples()) {
                yield sample;
            }
        }
        
        for await (const sample of getSamples()) {`;

code = code.replace(searchLoop, replaceLoop);

fs.writeFileSync('/app/applet/src/engine/processor.ts', code);
