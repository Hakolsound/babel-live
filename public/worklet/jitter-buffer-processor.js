/**
 * Jitter buffer AudioWorkletProcessor.
 *
 * Receives decoded Float32 PCM chunks from the main thread via port.postMessage,
 * queues them, and drains them at exactly the hardware sample rate.
 *
 * Target buffer depth: 400–600 ms.  If the queue grows > MAX_QUEUE_FRAMES it
 * starts dropping oldest frames to self-correct drift.
 */

const TARGET_BUFFER_MS = 500;
const MAX_BUFFER_MS    = 2000;

class JitterBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this._queue       = [];   // Float32Array chunks waiting to be played
    this._offset      = 0;    // read position within the current head chunk
    this._targetFrames = 0;   // filled in after we know sampleRate
    this._maxFrames    = 0;
    this._buffered     = 0;   // total samples queued
    this._started      = false;

    this.port.onmessage = (evt) => {
      if (evt.data.type === 'init') {
        // Main thread sends { type: 'init', sampleRate } — may differ from
        // AudioContext.sampleRate if resampling is needed, but we keep it simple.
        this._targetFrames = Math.round((TARGET_BUFFER_MS / 1000) * sampleRate);
        this._maxFrames    = Math.round((MAX_BUFFER_MS    / 1000) * sampleRate);
        return;
      }
      if (evt.data.type === 'chunk') {
        const samples = evt.data.samples; // Float32Array
        this._queue.push(samples);
        this._buffered += samples.length;

        // Overflow protection — drop oldest chunk
        while (this._buffered > this._maxFrames && this._queue.length > 0) {
          const dropped = this._queue.shift();
          this._buffered -= dropped.length;
          this._offset = 0;
        }

        // Don't start draining until we have at least targetFrames in the buffer
        if (!this._started && this._buffered >= this._targetFrames) {
          this._started = true;
        }
        return;
      }
      if (evt.data.type === 'flush') {
        this._queue   = [];
        this._offset  = 0;
        this._buffered = 0;
        this._started = false;
      }
    };
  }

  process(_inputs, outputs) {
    const output  = outputs[0];
    const channel = output[0]; // mono
    const need    = channel.length; // 128 frames per quantum

    if (!this._started) {
      // Silence while prebuffering
      channel.fill(0);
      return true;
    }

    let written = 0;
    while (written < need) {
      if (this._queue.length === 0) {
        // Underrun — fill remainder with silence
        channel.fill(0, written);
        break;
      }

      const chunk = this._queue[0];
      const available = chunk.length - this._offset;
      const toCopy    = Math.min(available, need - written);

      channel.set(chunk.subarray(this._offset, this._offset + toCopy), written);
      written        += toCopy;
      this._offset   += toCopy;
      this._buffered -= toCopy;

      if (this._offset >= chunk.length) {
        this._queue.shift();
        this._offset = 0;
      }
    }

    return true; // keep processor alive
  }
}

registerProcessor('jitter-buffer-processor', JitterBufferProcessor);
