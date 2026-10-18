// Constructs every custom ShaderMaterial in the game under Node (DOM stubbed), assembles the GLSL exactly the
// way three.js r186 WebGLProgram does for ShaderMaterial (WebGL2, log depth on), and validates each stage
// with the Khronos glslangValidator (ESSL 3.00).
import fs from 'fs';
import { execFileSync } from 'child_process';

// ---- minimal DOM stubs for canvas textures ----
const ctxProxy = () => new Proxy({}, {
  get(t, k) {
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() { } });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k in t) return t[k];
    return () => { };
  },
  set(t, k, v) { t[k] = v; return true; },
});
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => { };
globalThis.document = { createElement: () => ({ width: 300, height: 150, style: {}, getContext: () => ctxProxy(), addEventListener() { } }), addEventListener() { } };

const THREE = await import('three');
const registry = [];
const orig = THREE.ShaderMaterial.prototype.setValues;
THREE.ShaderMaterial.prototype.setValues = function (p) { if (!registry.includes(this)) registry.push(this); return orig.call(this, p); };

const stubRenderer = new Proxy({ getRenderTarget: () => null, getPixelRatio: () => 1, capabilities: { isWebGL2: true }, info: { render: {} } }, { get(t, k) { return k in t ? t[k] : () => { }; } });
const names = new Map();
const tag = (name, from) => { for (let i = from; i < registry.length; i++) if (!names.has(registry[i])) names.set(registry[i], name + (registry.length - from > 1 ? `#${i - from}` : '')); };

let n0 = registry.length;
const { initCloudTextures } = await import('../src/render/clouds.js');
initCloudTextures(stubRenderer); tag('cloudbake', n0);
const { Sky } = await import('../src/render/sky.js');
n0 = registry.length; const sky = new Sky(stubRenderer); tag('sky', n0);
const { Pipeline } = await import('../src/render/pipeline.js');
n0 = registry.length; const pipe = new Pipeline(stubRenderer, 1280, 720, { quality: 'medium' }); tag('pipeline', n0);
const { Terrain } = await import('../src/world/terrain.js');
const terrain = new Terrain();
const t0 = Date.now(); terrain.generate(); const genMs = Date.now() - t0;
n0 = registry.length; terrain.build(stubRenderer); tag('terrain', n0);
const { Ocean } = await import('../src/world/ocean.js');
n0 = registry.length; const ocean = new Ocean(terrain, stubRenderer); tag('ocean', n0);
const { FX, AfterburnerFlame } = await import('../src/fx/fx.js');
const fakeGame = { scene: new THREE.Scene(), wind: new THREE.Vector3(), terrain, ocean, audio: {}, camera: new THREE.PerspectiveCamera() };
n0 = registry.length; const fx = new FX(fakeGame, pipe); tag('fx', n0);
n0 = registry.length; new AfterburnerFlame(); tag('flame', n0);
const { Game } = await import('../src/game/game.js');
n0 = registry.length; const fake = { player: { model: { root: new THREE.Group() } } }; Game.prototype.buildVaporCone.call(fake); tag('vaporcone', n0);
const { attachLights, HORNET_LIGHTS } = await import('../src/fx/navlights.js');
n0 = registry.length; attachLights(new THREE.Group(), HORNET_LIGHTS); tag('navlights', n0);
// shock/wilson clones are created at runtime from these templates
console.log(`terrain generate: ${genMs} ms; materials: ${registry.length}`);

// ---- assemble GLSL like WebGLProgram ----
const precision = `precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
precision highp sampler3D;
precision highp sampler2DArray;
precision highp sampler2DShadow;
precision highp samplerCubeShadow;
precision highp sampler2DArrayShadow;
precision highp isampler2D;
precision highp isampler3D;
precision highp isamplerCube;
precision highp isampler2DArray;
precision highp usampler2D;
precision highp usampler3D;
precision highp usamplerCube;
precision highp usampler2DArray;
#define HIGH_PRECISION`;
function resolveIncludes(s, depth = 0) {
  return s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (m, inc) => {
    const c = THREE.ShaderChunk[inc]; if (c === undefined) throw new Error('missing chunk ' + inc);
    return resolveIncludes(c, depth + 1);
  });
}
function vertexGLSL(m) {
  const pre = ['#define attribute in', '#define varying out', '#define texture2D texture', precision,
    '#define SHADER_TYPE ShaderMaterial', '#define SHADER_NAME ' + (names.get(m) || 'mat'),
    m.side === THREE.DoubleSide ? '#define DOUBLE_SIDED' : '', '#define USE_LOGARITHMIC_DEPTH_BUFFER',
    'uniform mat4 modelMatrix;', 'uniform mat4 modelViewMatrix;', 'uniform mat4 projectionMatrix;', 'uniform mat4 viewMatrix;', 'uniform mat3 normalMatrix;', 'uniform vec3 cameraPosition;', 'uniform bool isOrthographic;',
    'attribute vec3 position;', 'attribute vec3 normal;', 'attribute vec2 uv;'].filter(Boolean).join('\n');
  return '#version 300 es\n' + pre + '\n' + resolveIncludes(m.vertexShader);
}
function fragmentGLSL(m) {
  // GLSL3 materials declare their own outputs (three leaves pc_fragColor out for them)
  const g3 = m.glslVersion === THREE.GLSL3;
  const pre = ['#define varying in', g3 ? '' : 'layout(location = 0) out highp vec4 pc_fragColor;', g3 ? '' : '#define gl_FragColor pc_fragColor', '#define gl_FragDepthEXT gl_FragDepth', '#define texture2D texture', '#define textureCube texture',
    '#define texture2DProj textureProj', '#define texture2DLodEXT textureLod', '#define texture2DProjLodEXT textureProjLod', '#define textureCubeLodEXT textureLod', '#define texture2DGradEXT textureGrad', '#define texture2DProjGradEXT textureProjGrad', '#define textureCubeGradEXT textureGrad',
    precision, '#define SHADER_TYPE ShaderMaterial', '#define SHADER_NAME ' + (names.get(m) || 'mat'),
    m.side === THREE.DoubleSide ? '#define DOUBLE_SIDED' : '', '#define USE_LOGARITHMIC_DEPTH_BUFFER',
    'uniform mat4 viewMatrix;', 'uniform vec3 cameraPosition;', 'uniform bool isOrthographic;',
    THREE.ShaderChunk['colorspace_pars_fragment'],
    'vec4 linearToOutputTexel( vec4 value ) { return value; }',
    'float luminance( const in vec3 rgb ) { const vec3 weights = vec3( 0.2126729, 0.7151522, 0.0721750 ); return dot( weights, rgb ); }',
  ].filter(Boolean).join('\n');
  return '#version 300 es\n' + pre + '\n' + resolveIncludes(m.fragmentShader);
}

const GV = 'node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux';
const dir = process.argv[2] || '/tmp';
let bad = 0;
registry.forEach((m, i) => {
  const name = (names.get(m) || 'mat' + i).replace(/[^\w#]/g, '_');
  for (const [stage, src] of [['vert', vertexGLSL(m)], ['frag', fragmentGLSL(m)]]) {
    const f = `${dir}/${name}.${stage}`;
    fs.writeFileSync(f, src);
    try { execFileSync(GV, [f], { stdio: 'pipe' }); }
    catch (e) {
      bad++;
      const out = (e.stdout || '').toString() + (e.stderr || '').toString();
      console.log(`---- ${name}.${stage} FAILED`);
      console.log(out.split('\n').filter(l => /ERROR|WARNING/.test(l)).slice(0, 12).join('\n'));
    }
  }
});
console.log(bad ? `${bad} shader stage(s) failed` : `all ${registry.length * 2} shader stages valid`);
