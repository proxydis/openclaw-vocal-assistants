// The orb: a single full-canvas fragment shader. State weights are eased in JS so every
// transition (agent change, listen → think → speak) morphs instead of cutting.

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time, u_level, u_awake, u_listen, u_think, u_speak, u_flash;
uniform vec3  u_color;
uniform sampler2D u_spec;   // 64 bands, mirrored left/right

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float v = 0., a = .5; for(int i=0;i<4;i++){ v += a*noise(p); p = p*2.03 + 7.1; a *= .5; } return v; }
float band(float r, float c, float w){ return smoothstep(w, 0., abs(r-c)); }
// Ring broken into arcs: k segments, duty = lit fraction, rot = rotation.
float arcs(float a, float k, float duty, float rot){
  float s = fract((a + rot) / 6.2831853 * k);
  return smoothstep(0., .04, s) * smoothstep(duty, duty-.04, s);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - .5*u_res) / min(u_res.x, u_res.y);
  float r = length(uv) * 2.0;            // 1.0 = canvas edge
  float a = atan(uv.y, uv.x);
  float t = u_time;
  float lvl = u_level;
  float energy = .25 + .75*u_awake;

  // Plasma membrane around the avatar disc; audio pushes it outward while speaking.
  vec2 dir = vec2(cos(a), sin(a));       // noise sampled on a circle: no seam where atan wraps
  float n = fbm(dir*1.7 + vec2(t*.25, t*.35 + r*2.));
  float n2 = fbm(dir*3.2 + vec2(-t*.6, t*.2));
  float edge = .50 + .02*sin(t*.8) + (n-.5)*(.035 + .10*u_speak*lvl + .04*u_think) + .05*u_speak*lvl;
  float membrane = band(r, edge, .018 + .03*lvl*u_speak) * (1.1 + n2);
  float halo = exp(-abs(r-edge)*9.) * (.30 + .5*lvl*(u_speak+u_listen) + .25*u_think);
  float inner = smoothstep(edge, edge-.10, r) * smoothstep(.30, edge, r) * .22; // rim light inside the disc

  // HUD rings.
  float spin = t*(.12 + .9*u_think);
  float r1 = band(r, .62, .004) * arcs(a, 3., .62, spin*1.3);
  float r2 = band(r, .70, .0025) * arcs(a, 5., .40, -spin*.9 + 1.);
  float r3 = band(r, .79, .006) * arcs(a, 2., .30 + .25*u_think, spin*2.1 + 2.);
  float r4 = band(r, .88, .002) * (.35 + .65*arcs(a, 1., .85, -spin*.3));
  float ticks = band(r, .915, .008) * step(.86, fract(a/6.2831853*72.)) * .35;
  float rings = r1*1.2 + r2*.9 + r3*1.0 + r4*.5 + ticks;

  // Listening: ripples travelling inward, driven by the mic.
  float rip = sin(r*46. + t*7.) * .5 + .5;
  float listen = u_listen * rip * smoothstep(.98, .55, r) * smoothstep(edge, edge+.06, r) * (.10 + .9*lvl);

  // Speaking: wavefronts travelling outward, driven by the voice.
  float wav = pow(sin(r*30. - t*9.) * .5 + .5, 3.);
  float speak = u_speak * wav * smoothstep(edge, edge+.04, r) * smoothstep(1.0, .6, r) * (.08 + 1.1*lvl);

  // Thinking: orbiting sparks.
  float sparks = 0.;
  for(int i=0;i<10;i++){
    float fi = float(i);
    float ang = t*(.9 + fi*.13) + fi*2.399;
    float rad = .58 + .30*hash(vec2(fi, 3.)) + .02*sin(t*2. + fi);
    vec2 sp = vec2(cos(ang), sin(ang)) * rad * .5;
    sparks += exp(-length(uv - sp)*90.) ;
  }
  sparks *= u_think * 1.6;

  float flash = u_flash * exp(-abs(r-(.5 + (1.-u_flash)*.55))*14.); // shockwave on wake / agent change

  // Spectrum ring: 64 bars per half-circle, mirrored around the vertical axis, outside the HUD rings.
  float m = abs(fract((a + 1.5707963)/6.2831853)*2. - 1.);        // 0 at top, 1 at bottom, mirrored
  float band = texture2D(u_spec, vec2(m*.985 + .0075, .5)).r;
  float slot = smoothstep(.0, .12, fract(m*64.)) * smoothstep(1., .88, fract(m*64.));
  float bars = slot * smoothstep(.935, .945, r) * smoothstep(.95 + .055*band, .94 + .055*band, r) * (.22 + 1.1*band) * u_awake;
  float glow = exp(-r*2.2) * .10;

  float lum = (membrane + halo + inner + rings*(.55 + .6*u_think + .3*lvl) + listen + speak + sparks + flash*1.4 + glow + bars*1.1) * energy;
  vec3 col = u_color * lum + vec3(1.) * (membrane*.35 + sparks*.5 + flash*.4) * energy;
  float alpha = clamp(lum, 0., 1.);
  gl_FragColor = vec4(col, alpha);
}`;

const ease = (cur, target, dt, speed) => cur + (target - cur) * (1 - Math.exp(-dt * speed));
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export class Orb {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = (this.gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true, antialias: false, powerPreference: "low-power" }));
    this.ok = Boolean(gl);
    this.state = "sleep";
    this.w = { awake: 0, listen: 0, think: 0, speak: 0, flash: 0 };
    this.color = [0.22, 0.74, 0.97];
    this.targetColor = this.color.slice();
    this.level = 0; this.levelTarget = 0;
    this.levelSource = () => 0;
    if (!this.ok) return;
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); this.ok = false; return; }
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog); gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = Object.fromEntries(["u_res", "u_time", "u_level", "u_awake", "u_listen", "u_think", "u_speak", "u_flash", "u_color", "u_spec"].map((n) => [n, gl.getUniformLocation(prog, n)]));
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this.spec = new Uint8Array(64); this.specTarget = new Uint8Array(64);
    this.specTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.spec);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.uniform1i(this.u.u_spec, 0);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.last = performance.now();
    const loop = (now) => { this.frame(now); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // beyond this the shader cost is not worth it
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(2, Math.round(width * dpr));
    this.canvas.height = Math.max(2, Math.round(height * dpr));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  setState(state) { this.state = state; }
  setSpectrum(bands) { this.specTarget.set(bands); }
  setColor(hex) { this.targetColor = hexToRgb(hex); }
  flash() { this.w.flash = 1; }

  frame(now) {
    if (document.hidden) { this.last = now; return; }
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const s = this.state, w = this.w, gl = this.gl;
    w.awake = ease(w.awake, s === "sleep" ? 0 : 1, dt, 3);
    w.listen = ease(w.listen, s === "listening" ? 1 : s === "idle" ? 0.25 : 0, dt, 6);
    w.think = ease(w.think, s === "thinking" || s === "tool" ? 1 : 0, dt, 4);
    w.speak = ease(w.speak, s === "speaking" ? 1 : 0, dt, 7);
    w.flash = ease(w.flash, 0, dt, 2.2);
    this.levelTarget = this.levelSource();
    const sp = this.spectrumSource?.(); if (sp) this.specTarget.set(sp); else this.specTarget.fill(0);
    this.level = ease(this.level, this.levelTarget, dt, this.levelTarget > this.level ? 28 : 9);
    for (let i = 0; i < 3; i++) this.color[i] = ease(this.color[i], this.targetColor[i], dt, 5);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.u_time, now / 1000);
    gl.uniform1f(this.u.u_level, this.level);
    gl.uniform1f(this.u.u_awake, w.awake); gl.uniform1f(this.u.u_listen, w.listen);
    gl.uniform1f(this.u.u_think, w.think); gl.uniform1f(this.u.u_speak, w.speak); gl.uniform1f(this.u.u_flash, w.flash);
    gl.uniform3fv(this.u.u_color, this.color);
    for (let i = 0; i < 64; i++) { const t = this.specTarget[i]; this.spec[i] += (t - this.spec[i]) * (t > this.spec[i] ? 0.55 : 0.18); }
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.spec);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
