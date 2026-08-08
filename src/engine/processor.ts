import { WatermarkEngine } from './watermarkEngine.js';
import { removeWatermark } from './blendModes.js';
import { resolveBox, getRoi, buildAlpha, cleanFrame } from './tuner.js';
import * as mb from 'mediabunny';
import WebSR from '@websr/websr';
import weights from '../weights/cnn-2x-l-rl.json';

// Defaults that, in practice, make the Veo watermark effectively invisible.
export const VIDEO_DEFAULTS = { gain: 0.6, offsetX: -24, offsetY: -24, sizeScale: 1 };

/**
 * Client-side Gemini Veo video watermark remover AND Upscaler.
 */
export class VideoWatermarkAndUpscaleEngine {
    engine: any;
    
    constructor(engine: any) {
        this.engine = engine; // a ready WatermarkEngine
    }
    
    static async create() {
        const engine = await WatermarkEngine.create();
        return new VideoWatermarkAndUpscaleEngine(engine);
    }
    
    static isSupported() {
        return (
            typeof VideoEncoder !== 'undefined' &&
            typeof VideoDecoder !== 'undefined'
        );
    }

    /** Default Veo watermark box (bottom-right): size ≈ shortSide/15, margin ≈ shortSide/10. */
    getVeoWatermark(width: number, height: number) {
        const base = Math.min(width, height);
        const size = Math.max(24, Math.min(Math.round(base / 15), base));
        const margin = Math.round(base / 10);
        return {
            size,
            x: Math.max(0, width - margin - size),
            y: Math.max(0, height - margin - size),
            width: size,
            height: size,
        };
    }

    async process(file: File, opts: any = {}) {
        const onProgress = opts.onProgress || (() => {});
        const gain = opts.gain ?? VIDEO_DEFAULTS.gain;
        
        const {
            ALL_FORMATS, BlobSource, BufferTarget, CanvasSource,
            EncodedAudioPacketSource, EncodedPacketSink, Input,
            Mp4OutputFormat, Output, QUALITY_HIGH, VideoSampleSink, canEncodeVideo,
        } = mb;

        if (canEncodeVideo && !(await canEncodeVideo('avc'))) {
            throw new Error(
                'Your browser cannot encode H.264 video locally. Please try the latest Chrome or Edge on desktop.'
            );
        }

        const originalUrl = URL.createObjectURL(file);
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack) {
            input.dispose?.();
            URL.revokeObjectURL(originalUrl);
            throw new Error('No decodable video track was found in this file.');
        }

        const duration = await input.computeDuration().catch(() => 0);
        
        // Extract dimensions from the first decoded sample to be absolutely certain
        const sink = new VideoSampleSink(videoTrack);
        const sampleIterator = sink.samples()[Symbol.asyncIterator]();
        const firstSampleResult = await sampleIterator.next();
        if (firstSampleResult.done) {
            throw new Error("No video frames could be decoded.");
        }
        const firstSample = firstSampleResult.value as any;
        const width = firstSample.displayWidth || firstSample.codedWidth;
        const height = firstSample.displayHeight || firstSample.codedHeight;
        if (!width || !height) {
            throw new Error("Could not resolve video dimensions from the first frame.");
        }
        let frameRate = 30;

        try {
            const stats = await videoTrack.computePacketStats(120);
            if (stats?.averagePacketRate) frameRate = Math.round(stats.averagePacketRate);
        } catch { /* keep default */ }

        // Setup Watermark
        const base = this.getVeoWatermark(width, height);
        const wm = resolveBox(base, width, height, opts);
        const roi = getRoi(width, height, wm);
        const alpha = buildAlpha(this.engine.bg96, roi, wm, gain);
        const region = { x: 0, y: 0, width: roi.width, height: roi.height };

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

        // Setup WebSR
        const upscaled_canvas = document.createElement('canvas');
        upscaled_canvas.width = width * 2;
        upscaled_canvas.height = height * 2;
        
        const resolutionMode = opts.resolutionMode || '1080p';
        
        const final_canvas = document.createElement('canvas');
        if (resolutionMode === '2k') {
            final_canvas.width = width * 2;
            final_canvas.height = height * 2;
        } else {
            final_canvas.width = 1080;
            final_canvas.height = 1920;
        }
        const final_ctx = final_canvas.getContext('2d', { willReadFrequently: true })!;
        
        const gpu = await WebSR.initWebGPU();
        if (!gpu) {
            throw new Error("WebGPU is not supported by your browser. Required for upscaling.");
        }
        
        const websr = new WebSR({
            network_name: "anime4k/cnn-2x-l",
            weights: weights,
            resolution: { width, height },
            gpu: gpu,
            canvas: upscaled_canvas
        });
        
        const target = new BufferTarget();
        const output = new Output({ format: new Mp4OutputFormat(), target });

        const encode_canvas = resolutionMode === '2k' ? upscaled_canvas : final_canvas;

        const videoSource = new CanvasSource(encode_canvas, {
            codec: 'avc',
            bitrate: QUALITY_HIGH,
            keyFrameInterval: 2,
            sizeChangeBehavior: 'passThrough',
        });
        output.addVideoTrack(videoSource, { frameRate });

        // Audio passthrough (best-effort).
        let audioSource: any = null;
        let audioTrack: any = null;
        let audioDecoderConfig: any = null;
        try {
            audioTrack = await input.getPrimaryAudioTrack();
            if (audioTrack) {
                const audioCodec = await audioTrack.getCodec();
                audioDecoderConfig = await audioTrack.getDecoderConfig().catch(() => null);
                if (audioCodec && audioDecoderConfig) {
                    audioSource = new EncodedAudioPacketSource(audioCodec);
                    output.addAudioTrack(audioSource);
                }
            }
        } catch {
            audioSource = null;
        }

        await output.start();

        const fallbackDur = frameRate > 0 ? 1 / frameRate : 1 / 30;

        let firstTimestamp: number | null = null;
        let lastTimestamp = -1;

        async function* getSamples() {
            yield firstSample;
            while (true) {
                const res = await sampleIterator.next();
                if (res.done) break;
                yield res.value;
            }
        }
        
        for await (const sample of getSamples() as any) {
            if (firstTimestamp === null) firstTimestamp = sample.timestamp;
            
            let timestamp = sample.timestamp - firstTimestamp;
            if (!(timestamp >= 0)) timestamp = 0;
            if (timestamp <= lastTimestamp) timestamp = lastTimestamp + fallbackDur;
            
            const dur =
                Number.isFinite(sample.duration) && sample.duration > 0
                    ? sample.duration
                    : fallbackDur;
                    
            lastTimestamp = timestamp;

            sample.draw(ctx, 0, 0, width, height);
            sample.close();
            
            // Remove watermark
            const px = ctx.getImageData(roi.x, roi.y, roi.width, roi.height);
            removeWatermark(px, alpha, region);
            ctx.putImageData(px, roi.x, roi.y);
            
            // Upscale
            const bmp = await createImageBitmap(canvas);
            await websr.render(bmp as any);
            bmp.close();
            
            // Draw to fixed 1080x1920 resolution
            if (resolutionMode !== '2k') {
                final_ctx.drawImage(upscaled_canvas, 0, 0, final_canvas.width, final_canvas.height);
            }

            await videoSource.add(timestamp, dur);
            
            if (duration) {
                onProgress({ progress: Math.min(0.99, timestamp / duration) });
            }
        }

        videoSource.close();

        if (audioSource) {
            try {
                const offset = firstTimestamp ?? 0;
                const aSink = new EncodedPacketSink(audioTrack);
                let isFirstAudio = true;
                let lastAudioTs = -1;
                
                for await (const packet of aSink.packets()) {
                    let newTs = packet.timestamp - offset;
                    if (newTs < 0) continue;
                    if (newTs <= lastAudioTs) newTs = lastAudioTs + 1e-6;
                    lastAudioTs = newTs;
                    let outPacket = packet;
                    if (newTs !== packet.timestamp && typeof packet.clone === 'function') {
                        outPacket = packet.clone({ timestamp: newTs });
                    }
                    await audioSource.add(
                        outPacket,
                        isFirstAudio && audioDecoderConfig ? { decoderConfig: audioDecoderConfig } : undefined
                    );
                    isFirstAudio = false;
                }
            } catch (e) {
                console.warn('Audio passthrough failed; exporting video only.', e);
            } finally {
                audioSource.close();
            }
        }

        await output.finalize();
        input.dispose?.();

        if (!target.buffer) {
            URL.revokeObjectURL(originalUrl);
            throw new Error('Video export produced no output.');
        }

        const blob = new Blob([target.buffer], { type: 'video/mp4' });
        onProgress({ progress: 1 });

        return {
            blob,
            url: URL.createObjectURL(blob),
            originalUrl,
            ext: 'mp4',
            mime: 'video/mp4',
            width: final_canvas.width,
            height: final_canvas.height,
        };
    }
}
