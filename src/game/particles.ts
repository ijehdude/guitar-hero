/**
 * Particle + popup system — the "juice". Additive-blended neon sparks, shock
 * rings on combo milestones, hit flashes and floating score/judgement text.
 * Pooled and capped so it stays smooth on mobile.
 */

interface P {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string;
  kind: "spark" | "ring" | "shard";
  rot: number; vr: number;
}

interface Popup {
  x: number; y: number; vy: number; life: number; max: number;
  text: string; color: string; size: number;
}

const MAX_PARTICLES = 420;

export class Particles {
  private items: P[] = [];
  private popups: Popup[] = [];

  private push(p: P) {
    if (this.items.length >= MAX_PARTICLES) this.items.shift();
    this.items.push(p);
  }

  hit(x: number, y: number, color: string, strength = 1) {
    const n = Math.round(10 * strength);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 220) * strength;
      this.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0, max: 0.45 + Math.random() * 0.3,
        size: 2 + Math.random() * 3 * strength,
        color, kind: "spark", rot: 0, vr: 0,
      });
    }
  }

  perfect(x: number, y: number, color: string) {
    this.hit(x, y, color, 1.4);
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 160;
      this.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: 0.5 + Math.random() * 0.3,
        size: 5 + Math.random() * 4,
        color: "#ffffff", kind: "shard",
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
      });
    }
    this.ring(x, y, color);
  }

  ring(x: number, y: number, color: string) {
    this.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.4, size: 10, color, kind: "ring", rot: 0, vr: 0 });
  }

  miss(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      this.push({
        x, y,
        vx: (Math.random() - 0.5) * 60, vy: 40 + Math.random() * 80,
        life: 0, max: 0.4, size: 2 + Math.random() * 2,
        color: "#6a6a8a", kind: "spark", rot: 0, vr: 0,
      });
    }
  }

  popup(x: number, y: number, text: string, color: string, size = 22) {
    if (this.popups.length > 24) this.popups.shift();
    this.popups.push({ x, y, vy: -70, life: 0, max: 0.7, text, color, size });
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.items.splice(i, 1);
        continue;
      }
      if (p.kind !== "ring") {
        p.vy += 520 * dt; // gravity
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 1.6 * dt;
        p.rot += p.vr * dt;
      }
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const u = this.popups[i];
      u.life += dt;
      u.y += u.vy * dt;
      u.vy *= 1 - 2 * dt;
      if (u.life >= u.max) this.popups.splice(i, 1);
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.items) {
      const t = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, t);
      if (p.kind === "ring") {
        const r = p.size + (1 - t) * 80;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * t + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === "shard") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 6, p.size, p.size / 3);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * t + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // popups (normal blend, bold)
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const u of this.popups) {
      const t = u.life / u.max;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.font = `700 ${u.size}px Rajdhani, system-ui, sans-serif`;
      ctx.fillStyle = u.color;
      ctx.shadowColor = u.color;
      ctx.shadowBlur = 12;
      ctx.fillText(u.text, u.x, u.y);
    }
    ctx.restore();
  }

  clear() {
    this.items.length = 0;
    this.popups.length = 0;
  }
}
