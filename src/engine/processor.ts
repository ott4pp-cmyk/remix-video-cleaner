import { WatermarkEngine } from './watermarkEngine.js';
import { removeWatermark } from './blendModes.js';
import { getWatermarkInfo } from './geometry.js';
import { resolveBox, getRoi, buildAlpha, cleanFrame } from './tuner.js';
import { extractFinalFrame, ExtractedFrame } from './videotoframes';
import * as mb from 'mediabunny';

export const VIDEO_DEFAULTS = { gain: 0.6, offsetX: -24, offsetY: -24, sizeScale: 1 };

// ── Advanced Watermark Auto-Detection System from DevdeskApp/gemini-watermark-remover ──
const alphaTemplateCache = new Map<number, {
  raw: Uint8ClampedArray;
  alphas: Float32Array;
  gradMag: Float32Array;
  size: number;
}>();

function getAlphaTemplateData(bgImg: HTMLImageElement, size: number) {
  const cached = alphaTemplateCache.get(size);
  if (cached) return cached;

  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const cx = c.getContext('2d', { willReadFrequently: true })!;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(bgImg, 0, 0, size, size);
  const raw = cx.getImageData(0, 0, size, size).data;

  const alphas = new Float32Array(size * size);
  for (let i = 0; i < alphas.length; i++) {
    const o = i * 4;
    alphas[i] = Math.max(raw[o], raw[o + 1], raw[o + 2]) / 255.0;
  }

  const gradMag = new Float32Array(size * size);
  for (let r = 1; r < size - 1; r++) {
    for (let col = 1; col < size - 1; col++) {
      const idx = r * size + col;
      const gx = alphas[idx + 1] - alphas[idx - 1];
      const gy = alphas[(r + 1) * size + col] - alphas[(r - 1) * size + col];
      gradMag[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  const template = { raw, alphas, gradMag, size };
  alphaTemplateCache.set(size, template);
  return template;
}

function evaluateCandidateMatch(
  imageData: ImageData,
  width: number,
  height: number,
  bgImg: HTMLImageElement,
  box: { x: number; y: number; size: number }
) {
  const { x, y, size } = box;
  if (x < 0 || y < 0 || x + size > width || y + size > height || size <= 0) {
    return { score: -1, variance: 0 };
  }

  const template = getAlphaTemplateData(bgImg, size);
  const { alphas, gradMag } = template;

  let sumL = 0, sumA = 0;
  let sumL2 = 0, sumA2 = 0;
  let sumLA = 0;
  let sumInvL = 0;
  let sumInvL2 = 0;
  let sumInvLA = 0;
  let sumG = 0, sumGA = 0;
  let sumG2 = 0, sumGA2 = 0;
  let sumGGA = 0;
  let n = 0;
  let nGrad = 0;
  const step = size > 64 ? 2 : 1;

  for (let r = 0; r < size; r += step) {
    const imgRow = y + r;
    for (let col = 0; col < size; col += step) {
      const imgCol = x + col;
      const imgIdx = (imgRow * width + imgCol) * 4;
      const alphaIdx = r * size + col;

      const rVal = imageData.data[imgIdx];
      const gVal = imageData.data[imgIdx + 1];
      const bVal = imageData.data[imgIdx + 2];

      const lum = 0.299 * rVal + 0.587 * gVal + 0.114 * bVal;
      const invLum = 255.0 - lum;
      const alpha = alphas[alphaIdx];

      sumL += lum;
      sumA += alpha;
      sumL2 += lum * lum;
      sumA2 += alpha * alpha;
      sumLA += lum * alpha;

      sumInvL += invLum;
      sumInvL2 += invLum * invLum;
      sumInvLA += invLum * alpha;
      n++;

      if (
        r > 0 &&
        r < size - 1 &&
        col > 0 &&
        col < size - 1 &&
        imgRow > 0 &&
        imgRow < height - 1 &&
        imgCol > 0 &&
        imgCol < width - 1
      ) {
        const leftIdx = (imgRow * width + (imgCol - 1)) * 4;
        const rightIdx = (imgRow * width + (imgCol + 1)) * 4;
        const upIdx = ((imgRow - 1) * width + imgCol) * 4;
        const downIdx = ((imgRow + 1) * width + imgCol) * 4;

        const lumLeft =
          0.299 * imageData.data[leftIdx] +
          0.587 * imageData.data[leftIdx + 1] +
          0.114 * imageData.data[leftIdx + 2];
        const lumRight =
          0.299 * imageData.data[rightIdx] +
          0.587 * imageData.data[rightIdx + 1] +
          0.114 * imageData.data[rightIdx + 2];
        const lumUp =
          0.299 * imageData.data[upIdx] +
          0.587 * imageData.data[upIdx + 1] +
          0.114 * imageData.data[upIdx + 2];
        const lumDown =
          0.299 * imageData.data[downIdx] +
          0.587 * imageData.data[downIdx + 1] +
          0.114 * imageData.data[downIdx + 2];

        const gx = lumRight - lumLeft;
        const gy = lumDown - lumUp;
        const imgGrad = Math.sqrt(gx * gx + gy * gy);
        const aGrad = gradMag[alphaIdx];

        sumG += imgGrad;
        sumGA += aGrad;
        sumG2 += imgGrad * imgGrad;
        sumGA2 += aGrad * aGrad;
        sumGGA += imgGrad * aGrad;
        nGrad++;
      }
    }
  }

  if (n === 0) return { score: -1, variance: 0 };

  const meanL = sumL / n;
  const meanA = sumA / n;
  const varL = Math.max(0, sumL2 / n - meanL * meanL);
  const varA = Math.max(0, sumA2 / n - meanA * meanA);

  if (varA <= 0.0001) {
    return { score: 0, variance: varL };
  }

  let nccWhite = 0;
  if (varL > 0.5) {
    const covLA = sumLA / n - meanL * meanA;
    nccWhite = covLA / Math.sqrt(varL * varA);
  }

  let nccDark = 0;
  const meanInvL = sumInvL / n;
  const varInvL = Math.max(0, sumInvL2 / n - meanInvL * meanInvL);
  if (varInvL > 0.5 && meanL > 160) {
    const covInvLA = sumInvLA / n - meanInvL * meanA;
    nccDark = covInvLA / Math.sqrt(varInvL * varA);
  }

  const nccLum = Math.max(nccWhite, nccDark);

  let nccGrad = 0;
  if (nGrad > 10) {
    const meanG = sumG / nGrad;
    const meanGA = sumGA / nGrad;
    const varG = Math.max(0, sumG2 / nGrad - meanG * meanG);
    const varGA = Math.max(0, sumGA2 / nGrad - meanGA * meanGA);
    if (varG > 0.5 && varGA > 0.0001) {
      const covGGA = sumGGA / nGrad - meanG * meanGA;
      nccGrad = Math.max(0, covGGA / Math.sqrt(varG * varGA));
    }
  }

  let fusedScore = nccLum * 0.65 + nccGrad * 0.35;
  if (varL < 20) {
    fusedScore = Math.max(fusedScore, nccLum * 0.4 + nccGrad * 0.6);
  }

  return { score: Math.max(0, fusedScore), variance: varL };
}

export function detectVideoWatermarkCandidate(
  imageData: ImageData,
  width: number,
  height: number,
  bgImg: HTMLImageElement
) {
  const baseDim = Math.min(width, height);
  const veoBase = {
    size: Math.max(24, Math.min(Math.round(baseDim / 15), baseDim)),
    margin: Math.round(baseDim / 10),
  };

  const layoutFamilies = [
    {
      presetKey: 'veo',
      name: 'Gemini Omni & Google Flow (Adaptive Inset)',
      baseSize: veoBase.size,
      calcPos: (s: number) => {
        const adaptiveOffset = Math.round(-24 * (baseDim / 720));
        const baseX = Math.max(0, width - veoBase.margin - veoBase.size);
        const baseY = Math.max(0, height - veoBase.margin - veoBase.size);
        return {
          x: Math.max(0, Math.min(width - s, baseX + adaptiveOffset)),
          y: Math.max(0, Math.min(height - s, baseY + adaptiveOffset)),
        };
      },
      gain: 0.6,
      prior: 1.06,
    },
    {
      presetKey: 'corner',
      name: 'Gemini Veo & Flow (Corner)',
      baseSize: veoBase.size,
      calcPos: (s: number) => {
        const baseX = Math.max(0, width - veoBase.margin - veoBase.size);
        const baseY = Math.max(0, height - veoBase.margin - veoBase.size);
        return {
          x: Math.max(0, Math.min(width - s, baseX)),
          y: Math.max(0, Math.min(height - s, baseY)),
        };
      },
      gain: 0.6,
      prior: 1.02,
    },
    {
      presetKey: 'sparkle',
      name: 'Gemini Sparkle (Standard Video)',
      baseSize: Math.max(24, Math.round(96 * (baseDim / 1536))),
      calcPos: (s: number) => {
        const m = Math.max(16, Math.round(192 * (baseDim / 1536)));
        return {
          x: Math.max(0, width - m - s),
          y: Math.max(0, height - m - s),
        };
      },
      gain: 0.6,
      prior: 1.01,
    },
  ];

  const scalePyramid = [0.65, 0.85, 1.0, 1.2, 1.45];
  let bestMatch: {
    layout: (typeof layoutFamilies)[0];
    size: number;
    scale: number;
    x: number;
    y: number;
    score: number;
  } | null = null;
  let bestScore = -1;

  for (const layout of layoutFamilies) {
    for (const scale of scalePyramid) {
      const s = Math.max(16, Math.min(Math.round(layout.baseSize * scale), Math.min(width, height) - 8));
      const pos = layout.calcPos(s);
      const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, {
        x: pos.x,
        y: pos.y,
        size: s,
      });
      const weightedScore = score * (layout.prior || 1.0);
      if (weightedScore > bestScore) {
        bestScore = weightedScore;
        bestMatch = {
          layout,
          size: s,
          scale,
          x: pos.x,
          y: pos.y,
          score: weightedScore,
        };
      }
    }
  }

  const baseX = Math.max(0, width - veoBase.margin - veoBase.size);
  const baseY = Math.max(0, height - veoBase.margin - veoBase.size);

  if (bestMatch && bestMatch.score > 0.05) {
    let refinedX = bestMatch.x;
    let refinedY = bestMatch.y;
    let refinedSize = bestMatch.size;
    let refinedScore = bestMatch.score;

    const fineSizes = [
      Math.max(16, Math.round(bestMatch.size * 0.92)),
      bestMatch.size,
      Math.min(Math.min(width, height) - 8, Math.round(bestMatch.size * 1.08)),
    ];
    const uniqueSizes = [...new Set(fineSizes)];

    for (const testSize of uniqueSizes) {
      for (let dy = -16; dy <= 16; dy += 4) {
        for (let dx = -16; dx <= 16; dx += 4) {
          const testX = Math.max(0, Math.min(width - testSize, bestMatch.x + dx));
          const testY = Math.max(0, Math.min(height - testSize, bestMatch.y + dy));
          const { score } = evaluateCandidateMatch(imageData, width, height, bgImg, {
            x: testX,
            y: testY,
            size: testSize,
          });
          const weightedScore = score * (bestMatch.layout.prior || 1.0);
          if (weightedScore > refinedScore) {
            refinedScore = weightedScore;
            refinedX = testX;
            refinedY = testY;
            refinedSize = testSize;
          }
        }
      }
    }

    const calculatedScale = Math.round((refinedSize / veoBase.size) * 100) / 100;
    return {
      matchFound: refinedScore >= 0.08,
      score: Math.min(1.0, refinedScore),
      name: `${bestMatch.layout.name} (${refinedSize}px)`,
      offsetX: refinedX - baseX,
      offsetY: refinedY - baseY,
      sizeScale: Math.max(0.5, Math.min(2.5, calculatedScale)),
      gain: bestMatch.layout.gain || 0.6,
    };
  }

  const fallbackOffset = Math.round(-24 * (baseDim / 720));
  return {
    matchFound: false,
    score: bestScore > 0 ? bestScore : 0,
    presetKey: 'veo',
    name: 'Gemini Omni & Google Flow (Adaptive Inset)',
    offsetX: fallbackOffset,
    offsetY: fallbackOffset,
    sizeScale: 1.0,
    gain: 0.6,
  };
}

export interface ProcessResult {
  blob: Blob;
  url: string;
  originalUrl: string;
  videoFileName: string;
  ext: string;
  mime: string;
  width: number;
  height: number;
  duration: number;
  finalFrame: ExtractedFrame;
  detectedPresetName: string;
}

/**
 * Client-side Gemini Veo video watermark remover (DevdeskApp/gemini-watermark-remover)
 * + Final frame lossless extractor (crayon-nickee/videotoframes).
 * Preserves 100% original video dimensions with zero upscaling.
 */
export class VideoWatermarkEngine {
  engine: any;

  constructor(engine: any) {
    this.engine = engine;
  }

  static async create() {
    const engine = await WatermarkEngine.create();
    return new VideoWatermarkEngine(engine);
  }

  static isSupported() {
    return (
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoDecoder !== 'undefined'
    );
  }

  get sparkleImage(): HTMLImageElement {
    return this.engine.bg96;
  }

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

  previewClean(fullImageData: ImageData, width: number, height: number, opts: any = {}) {
    const base = this.getVeoWatermark(width, height);
    return cleanFrame(this.engine.bg96, fullImageData, width, height, base, {
      ...opts,
      gain: opts.gain ?? VIDEO_DEFAULTS.gain,
    });
  }

  async process(file: File, opts: any = {}): Promise<ProcessResult> {
    const onProgress = opts.onProgress || (() => {});
    const {
      ALL_FORMATS,
      BlobSource,
      BufferTarget,
      CanvasSource,
      EncodedAudioPacketSource,
      EncodedPacketSink,
      Input,
      Mp4OutputFormat,
      Output,
      QUALITY_HIGH,
      VideoSampleSink,
      canEncodeVideo,
    } = mb;

    if (canEncodeVideo && !(await canEncodeVideo('avc'))) {
      throw new Error(
        'Your browser cannot encode H.264 video locally. Please try Chrome or Edge desktop.'
      );
    }

    const originalUrl = URL.createObjectURL(file);
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      input.dispose?.();
      URL.revokeObjectURL(originalUrl);
      throw new Error('No decodable video track found.');
    }

    const duration = await input.computeDuration().catch(() => 0);

    const sink = new VideoSampleSink(videoTrack);
    const sampleIterator = sink.samples()[Symbol.asyncIterator]();
    const firstSampleResult = await sampleIterator.next();
    if (firstSampleResult.done) {
      input.dispose?.();
      URL.revokeObjectURL(originalUrl);
      throw new Error('No video frames could be decoded.');
    }

    const firstSample = firstSampleResult.value as any;
    const width =
      videoTrack.displayWidth ??
      videoTrack.codedWidth ??
      firstSample.displayWidth ??
      firstSample.codedWidth;
    const height =
      videoTrack.displayHeight ??
      videoTrack.codedHeight ??
      firstSample.displayHeight ??
      firstSample.codedHeight;

    if (!width || !height) {
      firstSample.close?.();
      input.dispose?.();
      URL.revokeObjectURL(originalUrl);
      throw new Error('Could not resolve video dimensions.');
    }

    let frameRate = 30;
    try {
      const stats = await videoTrack.computePacketStats(120);
      if (stats?.averagePacketRate) frameRate = Math.round(stats.averagePacketRate);
    } catch {
      /* keep default */
    }

    // Create full-resolution canvas (Original Size, No Upscale)
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    // Draw first sample to run auto-detection if useAutoDetect is enabled
    firstSample.draw(ctx, 0, 0, width, height);
    let resolvedOpts = { ...opts };
    let detectedPresetName = 'Custom Manual';

    if (opts.autoDetect !== false) {
      const firstFrameData = ctx.getImageData(0, 0, width, height);
      const detected = detectVideoWatermarkCandidate(
        firstFrameData,
        width,
        height,
        this.engine.bg96
      );
      resolvedOpts = {
        ...opts,
        gain: detected.gain,
        offsetX: detected.offsetX,
        offsetY: detected.offsetY,
        sizeScale: detected.sizeScale,
      };
      detectedPresetName = detected.name;
    }

    const gain = resolvedOpts.gain ?? VIDEO_DEFAULTS.gain;
    const base =
      resolvedOpts.mode === 'gemini'
        ? getWatermarkInfo(width, height)
        : this.getVeoWatermark(width, height);
    const wm = resolveBox(base, width, height, resolvedOpts);
    const roi = getRoi(width, height, wm);
    const alpha = buildAlpha(this.engine.bg96, roi, wm, gain);
    const region = { x: 0, y: 0, width: roi.width, height: roi.height };

    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: QUALITY_HIGH,
      keyFrameInterval: 2,
      sizeChangeBehavior: 'passThrough',
    });
    output.addVideoTrack(videoSource, { frameRate });

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

      const px = ctx.getImageData(roi.x, roi.y, roi.width, roi.height);
      removeWatermark(px, alpha, region);

      // Force GPU texture sync for WebCodecs by using ImageBitmap (DevdeskApp/gemini-watermark-remover)
      const bmp = await createImageBitmap(px);
      ctx.drawImage(bmp, roi.x, roi.y);
      bmp.close();

      await videoSource.add(timestamp, dur);
      if (duration) {
        onProgress({
          progress: Math.min(0.92, (timestamp / duration) * 0.92),
          status: 'Removing watermark...',
        });
      }
    }

    // Keep a lossless PNG snapshot of the final cleaned canvas frame as fallback
    const fallbackFinalBlob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, 'image/png')
    );

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
            isFirstAudio && audioDecoderConfig
              ? { decoderConfig: audioDecoderConfig }
              : undefined
          );
          isFirstAudio = false;
        }
      } catch (e) {
        console.warn('Audio passthrough failed.', e);
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
    const cleanBase = file.name.replace(/\.[^/.]+$/, '');
    const videoFileName = `${cleanBase}_clean.mp4`;

    onProgress({ progress: 0.96, status: 'Extracting lossless final frame...' });

    // Extract the final frame from the processed watermark-free video using crayon-nickee/videotoframes
    let finalFrame: ExtractedFrame;
    try {
      finalFrame = await extractFinalFrame(blob, cleanBase);
    } catch {
      if (!fallbackFinalBlob) {
        throw new Error('Could not extract final frame from processed video.');
      }
      finalFrame = {
        blob: fallbackFinalBlob,
        url: URL.createObjectURL(fallbackFinalBlob),
        name: `${cleanBase}_final_frame.png`,
        time: Math.max(0, lastTimestamp),
        width,
        height,
      };
    }

    onProgress({ progress: 1, status: 'Complete' });

    return {
      blob,
      url: URL.createObjectURL(blob),
      originalUrl,
      videoFileName,
      ext: 'mp4',
      mime: 'video/mp4',
      width,
      height,
      duration: Math.max(duration, lastTimestamp),
      finalFrame,
      detectedPresetName,
    };
  }
}
