/**
 * AudioPlayer: WebCodecs AudioDecoder → AudioWorklet jitter buffer.
 *
 * Call flow:
 *   1. const check = checkAudioSupport()          — detect capability before creating
 *   2. await AudioPlayer.create(sampleRate)        — builds AudioContext + Worklet
 *   3. player.pushFrame(arrayBuffer)               — called for each binary WS frame
 *   4. await player.unlock()                       — resume AudioContext on user gesture
 *   5. player.destroy()                            — teardown
 *
 * Frame format (from worker):
 *   byte 0      = rolling sequence number (0–255)
 *   bytes 1..N  = raw Opus packet at 48 kHz mono
 */

const CODEC = 'opus';
const CHANNELS = 1;
const WORKLET_URL = '/worklet/jitter-buffer-processor.js';

// Typical ElevenLabs Opus chunk ≈ 20 ms = 20 000 µs.
// WebCodecs requires monotonically increasing timestamps across decode() calls.
const OPUS_FRAME_US = 20_000;

// ── Support detection ─────────────────────────────────────────────────────────

export type AudioUnsupportedReason =
  | 'no_audio_decoder'
  | 'no_audio_context'
  | 'no_audio_worklet'
  | 'unsupported_codec';

export interface AudioSupportResult {
  supported: boolean;
  reason?: AudioUnsupportedReason;
}

/**
 * Returns detailed support information so the UI can show a specific fallback message
 * rather than silently failing.
 */
export function checkAudioSupport(): AudioSupportResult {
  if (typeof AudioContext === 'undefined' || typeof window === 'undefined') {
    return { supported: false, reason: 'no_audio_context' };
  }
  if (typeof AudioDecoder === 'undefined') {
    return { supported: false, reason: 'no_audio_decoder' };
  }
  if (typeof AudioWorkletNode === 'undefined') {
    return { supported: false, reason: 'no_audio_worklet' };
  }
  return { supported: true };
}

/** @deprecated Use checkAudioSupport() for richer information */
export function isAudioDecoderSupported(): boolean {
  return checkAudioSupport().supported;
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface AudioPlayerMetrics {
  framesReceived: number;
  framesDecoded: number;
  framesDropped: number;
  decodeErrors: number;
  largeGaps: number;
  timestamp: number;
}

// ── AudioPlayer ───────────────────────────────────────────────────────────────

export class AudioPlayer {
  private decoder: AudioDecoder;
  private expectedSeq: number;
  private timestamp: number;       // µs, monotonically increasing

  // Metrics
  private _framesReceived = 0;
  private _framesDecoded = 0;
  private _framesDropped = 0;
  private _decodeErrors = 0;
  private _largeGaps = 0;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly workletNode: AudioWorkletNode,
    decoder: AudioDecoder,
  ) {
    this.decoder = decoder;
    this.expectedSeq = 0;
    this.timestamp = 0;
  }

  static async create(sampleRate: number): Promise<AudioPlayer> {
    const ctx = new AudioContext({ sampleRate });
    await ctx.audioWorklet.addModule(WORKLET_URL);

    const workletNode = new AudioWorkletNode(ctx, 'jitter-buffer-processor');
    workletNode.connect(ctx.destination);
    workletNode.port.postMessage({ type: 'init', sampleRate });

    const player = new AudioPlayer(ctx, workletNode, null as unknown as AudioDecoder);
    player.decoder = player.buildDecoder(sampleRate);
    return player;
  }

  private buildDecoder(sampleRate: number): AudioDecoder {
    const decoder = new AudioDecoder({
      output: (audioData) => {
        const frames = audioData.numberOfFrames;
        const samples = new Float32Array(frames * audioData.numberOfChannels);
        audioData.copyTo(samples, { planeIndex: 0 });
        audioData.close();
        this._framesDecoded++;
        this.workletNode.port.postMessage({ type: 'chunk', samples }, [samples.buffer]);
      },
      error: (err) => {
        this._decodeErrors++;
        console.error('[audio-player] decoder error', err);
        // Decoder is now closed; rebuild on next pushFrame via state check
      },
    });
    decoder.configure({ codec: CODEC, sampleRate, numberOfChannels: CHANNELS });
    return decoder;
  }

  /** Resume AudioContext after a user gesture (required by iOS/Safari). */
  async unlock(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * Push a raw binary frame from the worker WebSocket.
   * Frame format: [seqByte (1 byte)] + [raw Opus packet bytes]
   */
  pushFrame(buffer: ArrayBuffer): void {
    if (buffer.byteLength < 2) return;
    this._framesReceived++;

    const view = new DataView(buffer);
    const seq  = view.getUint8(0);

    // Sequence gap analysis
    const gap = (seq - this.expectedSeq + 256) % 256;
    if (gap > 0 && gap <= 10) {
      // Small gap — normal packet loss; let the decoder handle it
      this._framesDropped += gap;
    } else if (gap > 10) {
      // Large desync — flush jitter buffer and resync
      this._largeGaps++;
      this.workletNode.port.postMessage({ type: 'flush' });
    }
    this.expectedSeq = (seq + 1) & 0xff;

    const opusData = buffer.slice(1);

    // Rebuild decoder if it was closed by a prior decode error
    if (this.decoder.state === 'closed') {
      this.decoder = this.buildDecoder(this.ctx.sampleRate);
      this.timestamp = 0;
    }

    try {
      this.decoder.decode(new EncodedAudioChunk({
        type: 'key',           // Opus frames are always independently decodable
        timestamp: this.timestamp,
        duration: OPUS_FRAME_US,
        data: opusData,
      }));
      this.timestamp += OPUS_FRAME_US;
    } catch (err) {
      this._decodeErrors++;
      console.error('[audio-player] decode failed', err);
      // Rebuild so the next frame starts clean
      this.decoder = this.buildDecoder(this.ctx.sampleRate);
      this.timestamp = 0;
    }
  }

  /** Flush jitter buffer and reset decoder state (e.g. on language switch). */
  flush(): void {
    this.workletNode.port.postMessage({ type: 'flush' });
    if (this.decoder.state === 'closed') {
      this.decoder = this.buildDecoder(this.ctx.sampleRate);
    } else {
      this.decoder.reset();
      this.decoder.configure({ codec: CODEC, sampleRate: this.ctx.sampleRate, numberOfChannels: CHANNELS });
    }
    this.expectedSeq = 0;
    this.timestamp = 0;
  }

  /** Current playback metrics snapshot. */
  get metrics(): AudioPlayerMetrics {
    return {
      framesReceived: this._framesReceived,
      framesDecoded:  this._framesDecoded,
      framesDropped:  this._framesDropped,
      decodeErrors:   this._decodeErrors,
      largeGaps:      this._largeGaps,
      timestamp:      this.timestamp,
    };
  }

  destroy(): void {
    try { this.decoder.close(); } catch { /* already closed */ }
    this.workletNode.disconnect();
    void this.ctx.close();
  }
}
