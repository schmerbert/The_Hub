const TWO_PI = Math.PI * 2;

class CornerWave {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.amplitude = options.amp ?? .28;
    this.state = 'idle';
    this.time = 0;
    this.running = false;
    this.frame = 0;
  }

  setState(state) { this.state = state; }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      this.draw();
      this.time += this.state === 'calling provider' ? .11 : this.state === 'assembling' ? .085 : .045;
      if (this.running) this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor((this.canvas.clientWidth || this.canvas.width) * dpr));
    const height = Math.max(1, Math.floor((this.canvas.clientHeight || this.canvas.height) * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    const ctx = this.context;
    ctx.clearRect(0, 0, width, height);
    const boost = this.state === 'calling provider' ? 1.9 : this.state === 'assembling' ? 1.55 : this.state === 'failed' || this.state === 'host unavailable' ? .7 : 1;
    const mid = height * .52;
    for (const wave of [{ amp: this.amplitude * boost, frequency: 1.6, phase: 0, color: 'rgba(212,164,90,.86)' }, { amp: this.amplitude * .55 * boost, frequency: 2.4, phase: 1.2, color: 'rgba(126,184,160,.42)' }]) {
      ctx.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const n = x / width;
        const y = mid + Math.sin(n * TWO_PI * wave.frequency + this.time + wave.phase) * wave.amp * height + Math.sin(n * TWO_PI * .7 + this.time * .6) * wave.amp * .25 * height;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = wave.color; ctx.lineWidth = Math.max(1.5, 2 * dpr); ctx.lineCap = 'round'; ctx.stroke();
    }
  }
}

window.CornerWave = CornerWave;
