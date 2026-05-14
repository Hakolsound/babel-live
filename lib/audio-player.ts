/**
 * AudioPlayer: WebCodecs AudioDecoder → AudioWorklet jitter buffer.
 *
 * Call flow:
 *   1. await AudioPlayer.create(sampleRate)   — builds AudioContext + Worklet
 *   2. player.pushFrame(arrayBuffer)           — called for each binary WS frame
 *   3. player.destroy()                        — teardown
 *
 * Frame format (from worker):
 *   byte 0      = rolling sequence number (0–255)
 *   bytes 1..N  = raw Opus packet(s) at 48 kHz mono
 */

const CODEC = 'opus';
const CHANNELS = 1;
const WORKLET_URL = '/worklet/jitter-buffer-processor.js';

// Typical ElevenLabs Opus chunk is ~20 ms = 20 000 µs.
// We don't know exact duration per packet, but timestamps just need to increase.
const OPUS_FRAME_US = 20_000;

export class AudioPlayer {
  private constructor(
    private readonly ctx: AudioContext,
    private readonly workletNode: AudioWorkletNode,
    private decoder: AudioDecoder,
    private expectedSeq: number,
    private timestamp = 0,
  ) {}

  static async create(sampleRate: number): Promise<AudioPlayer> {
    const ctx = new AudioContext({ sampleRate });

    await ctx.audioWorklet.addModule(WORKLET_URL);
    const workletNode = new AudioWorkletNode(ctx, 'jitter-buffer-processor');
    workletNode.connect(ctx.destination);
    workletNode.port.postMessage({ type: 'init', sampleRate });

    const player = new AudioPlayer(ctx, workletNode, null as unknown as AudioDecoder, 0, 0);
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
        this.workletNode.port.postMessage({ type: 'chunk', samples }, [samples.buffer]);
      },
      error: (err) => {
        console.error('[audio-player] decoder error', err);
      },
    });
    decoder.configure({ codec: CODEC, sampleRate, numberOfChannels: CHANNELS });
    return decoder;
  }

  /** Call once after constructing, after a user gesture, to resume AudioContext on iOS. */
  async unlock(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * Push a raw binary frame from the worker WebSocket.
   * Frame: [seqByte (1)] + [opus packet bytes (rest)]
   */
  pushFrame(buffer: ArrayBuffer): void {
    if (buffer.byteLength < 2) return;

    const view = new DataView(buffer);
    const seq  = view.getUint8(0);

    // Drop duplicate or old frames (seq is 0–255 rolling)
    if (seq !== this.expectedSeq) {
      // Allow one-step gaps (lost packet) but not large jumps
      const gap = (seq - this.expectedSeq + 256) % 256;
      if (gap > 10) {
        // Large desync — flush jitter buffer and resync
        this.workletNode.port.postMessage({ type: 'flush' });
      }
    }
    this.expectedSeq = (seq + 1) & 0xff;

    const opusData = buffer.slice(1);

    if (this.decoder.state === 'closed') {
      this.decoder = this.buildDecoder(this.ctx.sampleRate);
    }

    try {
      this.decoder.decode(new EncodedAudioChunk({
        type: 'key',
        timestamp: this.timestamp,
        duration: OPUS_FRAME_US,
        data: opusData,
      }));
      this.timestamp += OPUS_FRAME_US;
    } catch (err) {
      console.error('[audio-player] decode failed', err);
      // Decoder is now closed; rebuild so the next frame can succeed
      this.decoder = this.buildDecoder(this.ctx.sampleRate);
      this.timestamp = 0;
    }
  }

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

  destroy(): void {
    try { this.decoder.close(); } catch { /* already closed */ }
    this.workletNode.disconnect();
    void this.ctx.close();
  }
}

/** True if WebCodecs AudioDecoder is available in this browser. */
export function isAudioDecoderSupported(): boolean {
  return (
    typeof AudioDecoder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined'
  );
}
