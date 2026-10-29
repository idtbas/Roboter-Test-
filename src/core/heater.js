// Lumped thermal model of a heater (hotend / heatbed) with a Marlin-style
// PID controller ("functional range": full power far away from target).

export class Heater {
  constructor(o) {
    this.name = o.name || 'heater';
    this.power = o.power; // W at 100 % duty
    this.capacity = o.capacity; // J/K
    this.loss = o.loss; // W/K to ambient
    this.ambient = o.ambient ?? 23.5;
    this.kp = o.kp;
    this.ki = o.ki;
    this.kd = o.kd;
    this.range = o.range ?? 10;
    this.maxTemp = o.maxTemp ?? 300;
    this.noise = o.noise ?? 0.08;
    this.temp = this.ambient + (Math.random() - 0.5) * 0.6;
    this.target = 0;
    this.duty = 0;
    this.integral = 0;
    this.prevErr = 0;
    this.extraLoss = 0; // W/K additional (fans)
    this.extraLoad = 0; // W absorbed (melting filament)
    this.enabled = true;
    this.displayTemp = this.temp;
    this._noiseT = 0;
    this.fault = null;
  }

  setTarget(t) {
    t = Math.max(0, Math.min(this.maxTemp - 15, t || 0));
    if (t > 0 && this.target === 0) this.integral = 0;
    this.target = t;
  }

  get reached() {
    return this.target > 0 && Math.abs(this.temp - this.target) < 1.5;
  }

  heatingUp() {
    return this.target > 0 && this.temp < this.target - 1.5;
  }

  // ambient-equilibrium duty needed to hold a temperature
  holdDuty(t) {
    return Math.min(1, Math.max(0, ((this.loss + this.extraLoss) * (t - this.ambient) + this.extraLoad) / this.power));
  }

  update(dt) {
    // sub-steps for stability at high simulation speeds
    let rem = dt;
    while (rem > 1e-6) {
      const h = Math.min(rem, 0.05);
      rem -= h;
      this.step(h);
    }
    this._noiseT -= dt;
    if (this._noiseT <= 0) {
      this._noiseT = 0.35;
      this.displayTemp = this.temp + (Math.random() - 0.5) * this.noise * 2;
    }
  }

  step(dt) {
    let duty = 0;
    if (this.enabled && this.target > 0 && !this.fault) {
      const err = this.target - this.temp;
      if (err > this.range) {
        duty = 1;
        this.integral = this.holdDuty(this.target) / Math.max(1e-6, this.ki);
      } else if (err < -this.range) {
        duty = 0;
        this.integral = 0;
      } else {
        const d = (err - this.prevErr) / dt;
        const p = this.kp * err;
        let out = p + this.ki * this.integral + this.kd * d;
        if (out > 0 && out < 1) this.integral += err * dt;
        out = p + this.ki * this.integral + this.kd * d;
        duty = Math.max(0, Math.min(1, out));
      }
      this.prevErr = err;
    } else {
      this.prevErr = 0;
    }
    this.duty = duty;
    const pIn = duty * this.power;
    const pOut = (this.loss + this.extraLoss) * (this.temp - this.ambient) + this.extraLoad;
    this.temp += ((pIn - pOut) / this.capacity) * dt;
    if (this.temp < this.ambient - 1) this.temp = this.ambient - 1;
  }
}
