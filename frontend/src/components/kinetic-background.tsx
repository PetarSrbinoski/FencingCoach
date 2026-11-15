"use client";

import { useEffect, useRef } from "react";

/** Slow neutral-field drift and fine signal contours; no WebGL or image payload. */
export function KineticBackground({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clockRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    let time = clockRef.current;
    let previous = 0;
    let lastPaint = 0;
    let impulse = 0;
    let pointerX = 0;
    let pointerY = 0;
    let driftX = 0;
    let driftY = 0;
    let accent = "145 35% 29%";
    let ink = "145 13% 15%";
    let dark = false;
    const compact = window.matchMedia("(max-width: 767px)");

    const colors = () => {
      const style = getComputedStyle(document.documentElement);
      accent = style.getPropertyValue("--accent").trim();
      ink = style.getPropertyValue("--foreground").trim();
      dark = document.documentElement.classList.contains("dark");
    };
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (!enabled || document.hidden) paint();
    };
    const paint = () => {
      context.clearRect(0, 0, width, height);
      driftX += (pointerX * 16 - driftX) * 0.025;
      driftY += (pointerY * 12 - driftY) * 0.025;
      const radius = Math.max(width, height) * 0.62;
      const fields = [
        { x: 0.78, y: 0.34, phase: 0 },
        { x: 0.4, y: 0.88, phase: 2.1 },
        { x: 0.98, y: 0.85, phase: 4.2 },
      ];
      for (const field of fields) {
        const x = width * (field.x + Math.sin(time * 0.13 + field.phase) * 0.12) + driftX;
        const y = height * (field.y + Math.cos(time * 0.1 + field.phase) * 0.14) + driftY;
        const wash = context.createRadialGradient(x, y, 0, x, y, radius);
        wash.addColorStop(0, `hsl(${ink} / ${dark ? 0.018 : 0.025})`);
        wash.addColorStop(0.55, `hsl(${ink} / 0.008)`);
        wash.addColorStop(1, `hsl(${ink} / 0)`);
        context.fillStyle = wash;
        context.fillRect(0, 0, width, height);
      }
      // A low-contrast wire study at the edge of the canvas, never over the data.
      const centerX = width * 0.96 + driftX;
      const centerY = height * 0.92 + driftY;
      const scale = Math.min(width, height) * 0.28;
      context.lineWidth = 0.7;
      context.strokeStyle = `hsl(${ink} / ${dark ? 0.045 : 0.035})`;
      for (let ring = 0; ring < 12; ring++) {
        const phase = ring / 11;
        const tilt = Math.sin(time * 0.1 + phase * Math.PI) * 0.18;
        context.beginPath();
        context.ellipse(centerX, centerY + (phase - 0.5) * scale,
          scale * Math.sin(phase * Math.PI) + 1, scale * 0.22, tilt, 0, Math.PI * 2);
        context.stroke();
      }
      const angle = time * 0.18;
      context.beginPath();
      context.arc(centerX + Math.cos(angle) * scale * 0.75,
        centerY + Math.sin(angle) * scale * 0.28, 2 + impulse * 2, 0, Math.PI * 2);
      context.fillStyle = `hsl(${accent} / ${dark ? 0.28 : 0.2})`;
      context.fill();
      impulse *= 0.94;
    };
    const tick = (timestamp: number) => {
      if (document.hidden || !enabled) return;
      if (timestamp - lastPaint >= (compact.matches ? 50 : 1000 / 30)) {
        time += previous ? Math.min((timestamp - previous) / 1000, 0.08) * (1 + impulse * 3) : 0;
        clockRef.current = time;
        previous = timestamp;
        lastPaint = timestamp;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (!document.hidden && enabled) frame = requestAnimationFrame(tick);
    };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointerX = event.clientX / width - 0.5;
      pointerY = event.clientY / height - 0.5;
    };
    const burst = () => { impulse = 1; };
    const observer = new MutationObserver(() => {
      colors();
      if (!enabled) paint();
    });
    colors();
    resize();
    paint();
    if (enabled) frame = requestAnimationFrame(tick);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", pointer, { passive: true });
    window.addEventListener("coach:navigate", burst);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("coach:navigate", burst);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled]);

  return <canvas ref={canvasRef} className="kinetic-background" aria-hidden="true" />;
}
