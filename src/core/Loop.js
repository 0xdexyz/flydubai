// requestAnimationFrame game loop with a fixed-timestep accumulator.
// Physics runs at a constant rate (stable and deterministic), while
// rendering and HUD run once per displayed frame.

export class Loop {
  constructor({ fixedStep = 1 / 120, maxSubSteps = 8, fixedUpdate, update, render }) {
    this.fixedStep = fixedStep;
    this.maxSubSteps = maxSubSteps;
    this.fixedUpdate = fixedUpdate;
    this.update = update;
    this.render = render;
    this.acc = 0;
    this.last = 0;
    this.raf = 0;
    this.running = false;
    this.tick = this.tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  tick(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1; // tab switch / hitch guard
    if (dt < 0) dt = 0;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.fixedStep && steps < this.maxSubSteps) {
      this.fixedUpdate(this.fixedStep);
      this.acc -= this.fixedStep;
      steps++;
    }
    if (steps >= this.maxSubSteps) this.acc = 0;

    this.update(dt);
    this.render(dt);
  }
}
