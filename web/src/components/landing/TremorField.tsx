"use client";

import { useEffect, useRef } from "react";

/**
 * Hero background: a field of seismograph traces drawn in one WebGL fragment shader.
 * The traces stay calm at the edges and shake near the centre, with a periodic "tremor"
 * burst and a ripple that follows the pointer. A red glow rises from the bottom.
 *
 * Renders one still frame under prefers-reduced-motion, pauses off-screen and in hidden tabs,
 * and falls back to a CSS gradient when WebGL is unavailable.
 */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;     // 0..1, y up
uniform float uMouseOn;  // 0..1 eased

const float LINES = 46.0;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

// Displacement of trace k at horizontal position x.
float trace(float k, float x, float t, float env) {
  float s = hash(k * 1.37);
  float d = 0.0;
  d += sin(x * 21.0 + t * 1.3 + s * 6.28) * 0.55;
  d += sin(x * 47.0 - t * 2.1 + s * 12.0) * 0.30;
  d += sin(x * 113.0 + t * 3.7 + s * 3.1) * 0.18 * env;
  d += sin(x * 241.0 - t * 6.0 + k) * 0.10 * env;
  return d;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  float t = uTime;

  // Periodic tremor burst every 7 s, spreading outward from the centre.
  float ph = mod(t, 7.0);
  float burst = exp(-ph * 1.1) * smoothstep(0.0, 0.08, ph);

  float y = uv.y * LINES;
  float base = floor(y);
  float best = 1e3;
  float bestEnv = 0.0;

  for (int j = -2; j <= 2; j++) {
    float k = base + float(j);
    float x = uv.x;
    float cx = (x - 0.5) * aspect;
    float cy = (k + 0.5) / LINES - 0.42;
    // Envelope: strongest in an ellipse around the centre.
    float env = exp(-(cx * cx) / 0.10 - (cy * cy) / 0.06);
    float spread = exp(-abs(cx) * (3.2 - 2.4 * burst));
    float amp = 0.10 + 1.25 * env + 1.6 * burst * spread * exp(-(cy * cy) / 0.09);

    // Pointer ripple.
    vec2 m = vec2((uMouse.x - 0.5) * aspect, uMouse.y);
    vec2 q = vec2(cx, (k + 0.5) / LINES);
    float md = length(q - vec2(m.x, m.y));
    amp += uMouseOn * 1.4 * exp(-md * md / 0.012) * (0.6 + 0.4 * sin(md * 60.0 - t * 8.0));

    float off = trace(k, x, t, env + burst) * amp * 0.42;
    float dist = abs(y - (k + 0.5 + off));
    if (dist < best) { best = dist; bestEnv = env + burst * spread; }
  }

  float px = LINES / uRes.y;           // one pixel in line units
  float w = 0.9 * px + 0.012;
  float line = smoothstep(w * 1.8, 0.0, best);

  vec3 grey = vec3(0.42, 0.42, 0.45);
  vec3 red = vec3(0.949, 0.271, 0.169);
  vec3 col = mix(grey, red, clamp(bestEnv * 1.6, 0.0, 1.0));
  float alpha = line * (0.20 + 0.75 * clamp(bestEnv * 1.3, 0.0, 1.0));

  // Red glow from below, after the brand's halo.
  vec2 g = vec2((uv.x - 0.5) * aspect, uv.y + 0.25);
  float glow = exp(-dot(g, g) * 2.6) * (0.55 + 0.25 * burst);

  vec3 bg = vec3(0.035, 0.035, 0.039);
  vec3 outc = bg + red * glow * 0.55 + col * alpha;

  // Vignette and a fade into the page at the bottom edge.
  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(aspect * 0.8, 1.0)));
  outc = mix(bg, outc, vig);
  outc = mix(bg, outc, smoothstep(0.0, 0.18, uv.y));

  gl_FragColor = vec4(outc, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log ?? "shader compile failed");
  }
  return s;
}

export function TremorField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "low-power" });
    if (!gl) {
      canvas.dataset.fallback = "true";
      return;
    }
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link failed");
    } catch (e) {
      console.warn("TremorField: WebGL unavailable,", e);
      canvas.dataset.fallback = "true";
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uMouse = gl.getUniformLocation(prog, "uMouse");
    const uMouseOn = gl.getUniformLocation(prog, "uMouseOn");

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mouse = { x: 0.5, y: 0.5, on: 0, target: 0 };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const draw = (t: number) => {
      resize();
      mouse.on += (mouse.target - mouse.on) * 0.06;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uMouseOn, mouse.on);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    if (reduced) {
      draw(2.2);
      const onResize = () => draw(2.2);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    let raf = 0;
    let visible = true;
    const start = performance.now();
    const loop = () => {
      raf = 0;
      if (!visible || document.hidden) return;
      draw((performance.now() - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop);
    };

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      kick();
    });
    io.observe(canvas);
    const onVis = () => kick();
    document.addEventListener("visibilitychange", onVis);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - r.left) / r.width;
      mouse.y = 1 - (e.clientY - r.top) / r.height;
      mouse.target = mouse.y >= 0 && mouse.y <= 1 ? 1 : 0;
    };
    const onLeave = () => (mouse.target = 0);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    kick();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`block h-full w-full data-[fallback=true]:bg-[radial-gradient(60%_50%_at_50%_110%,rgb(242_69_43/0.35),transparent_70%)] ${className}`}
    />
  );
}
