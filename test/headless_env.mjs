// Node environment for running the full game without a browser: DOM stubs, a canvas-2D proxy and a stub
// WebGL2 context that accepts every call (shaders "compile", programs "link"), so all game logic runs.
const constNames = new Map(); let nextConst = 0x8000;
const constOf = (name) => { if (!constNames.has(name)) constNames.set(name, nextConst++); return constNames.get(name); };
const nameOf = new Map();
const PARAMS = {
  MAX_TEXTURE_SIZE: 8192, MAX_CUBE_MAP_TEXTURE_SIZE: 8192, MAX_VERTEX_ATTRIBS: 16, MAX_TEXTURE_IMAGE_UNITS: 16, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32, MAX_VERTEX_UNIFORM_VECTORS: 1024, MAX_VARYING_VECTORS: 30, MAX_FRAGMENT_UNIFORM_VECTORS: 1024, MAX_SAMPLES: 4,
  MAX_RENDERBUFFER_SIZE: 8192, MAX_3D_TEXTURE_SIZE: 2048, MAX_ARRAY_TEXTURE_LAYERS: 2048, MAX_DRAW_BUFFERS: 8, MAX_COLOR_ATTACHMENTS: 8,
  VERSION: 'WebGL 2.0 (stub)', SHADING_LANGUAGE_VERSION: 'WebGL GLSL ES 3.00', VENDOR: 'stub', RENDERER: 'stub', MAX_VIEWPORT_DIMS: new Int32Array([8192, 8192]),
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: 16, MAX_UNIFORM_BLOCK_SIZE: 65536,
};
export function makeGL(canvas) {
  const counts = { draw: 0, programs: 0, shaders: 0, textures: 0 };
  const gl = new Proxy({ canvas, drawingBufferWidth: 1280, drawingBufferHeight: 720, __counts: counts, shaderSources: [] }, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(k)) { const v = constOf(k); nameOf.set(v, k); return v; }
      switch (k) {
        case 'getParameter': return (p) => { const n = nameOf.get(p); if (n === 'VIEWPORT' || n === 'SCISSOR_BOX') return new Int32Array([0, 0, 1280, 720]); return n in PARAMS ? PARAMS[n] : 0; };
        case 'getExtension': return (name) => new Proxy({ name }, { get(o, kk) { if (kk in o) return o[kk]; if (typeof kk === 'string' && /^[A-Z0-9_]+$/.test(kk)) { const v = constOf(kk); nameOf.set(v, kk); return v; } return () => { }; } });
        case 'getSupportedExtensions': return () => ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'EXT_texture_filter_anisotropic', 'EXT_float_blend'];
        case 'getShaderPrecisionFormat': return () => ({ rangeMin: 127, rangeMax: 127, precision: 23 });
        case 'getContextAttributes': return () => ({ alpha: true, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' });
        case 'getShaderParameter': return () => true;
        case 'getProgramParameter': return (prog, p) => { const n = nameOf.get(p); if (n === 'ACTIVE_UNIFORMS' || n === 'ACTIVE_ATTRIBUTES') return 0; return true; };
        case 'getShaderInfoLog': case 'getProgramInfoLog': return () => '';
        case 'checkFramebufferStatus': return () => constOf('FRAMEBUFFER_COMPLETE');
        case 'isContextLost': return () => false;
        case 'getUniformLocation': return () => ({});
        case 'getAttribLocation': return () => 0;
        case 'getUniformBlockIndex': return () => 0;
        case 'shaderSource': return (sh, src) => { t.shaderSources.push(src); };
        case 'createProgram': return () => { counts.programs++; return {}; };
        case 'createShader': return () => { counts.shaders++; return {}; };
        case 'createTexture': return () => { counts.textures++; return {}; };
        case 'createBuffer': case 'createFramebuffer': case 'createRenderbuffer': case 'createVertexArray': case 'createQuery': case 'createSampler': return () => ({});
        case 'drawElements': case 'drawArrays': case 'drawElementsInstanced': case 'drawArraysInstanced': return () => { counts.draw++; };
        case 'getError': return () => 0;
        case 'fenceSync': return () => ({});
        case 'clientWaitSync': return () => constOf('ALREADY_SIGNALED');
        default: return () => undefined;
      }
    },
  });
  return gl;
}
const ctx2d = () => new Proxy({ canvas: null }, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() { } });
    if (k === 'measureText') return (s) => ({ width: String(s).length * 8 });
    return () => { };
  },
  set(t, k, v) { t[k] = v; return true; },
});
export function makeCanvas() {
  const c = { width: 300, height: 150, style: {}, className: '', addEventListener() { }, removeEventListener() { }, setAttribute() { }, requestPointerLock() { }, focus() { }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  c.getContext = (type) => { if (type === 'webgl2') { c.gl = c.gl || makeGL(c); return c.gl; } if (type === '2d') return c._2d || (c._2d = ctx2d()); return null; };
  return c;
}
export function installDOM() {
  const g = globalThis;
  g.window = g; g.self = g;
  g.innerWidth = 1280; g.innerHeight = 720; g.devicePixelRatio = 1;
  g.listeners = {};
  g.addEventListener = (type, fn) => { (g.listeners[type] = g.listeners[type] || []).push(fn); };
  g.removeEventListener = () => { };
  g.matchMedia = () => ({ matches: false, addEventListener() { } });
  g.requestAnimationFrame = () => 0;
  g.document = {
    createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild() { }, addEventListener() { }, setAttribute() { } }),
    createElementNS: (ns, tag) => makeCanvas(),
    addEventListener() { }, exitPointerLock() { }, pointerLockElement: null, fullscreenElement: null, body: { appendChild() { } },
    fonts: { load: async () => { } },
  };
  try { g.navigator = g.navigator || { hardwareConcurrency: 8, userAgent: 'node' }; } catch (e) { /* read-only navigator in newer node */ }
}
