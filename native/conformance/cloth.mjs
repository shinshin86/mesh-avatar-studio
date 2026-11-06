import { writeFile } from 'node:fs/promises';
import { createCloth } from '../../packages/runtime/src/engine/cloth.js';
import { pendulumSystem, stepPendulum, pendulumEnergy } from '../../packages/runtime/src/engine/cloth-pendulum.js';
import { createRig } from '../../packages/runtime/src/engine/rig.js';
import { createPhysics } from '../../packages/runtime/src/engine/physics.js';
import { Motion } from '../../packages/runtime/src/engine/motion.js';
import { createRenderer } from '../../packages/runtime/src/engine/renderer.js';
import { validateRig } from '../../packages/runtime/src/rig/validate.ts';
import { seededRandom } from '../../tools/motion-scenarios.mjs';
import { clothRig } from './cloth-rigs.mjs';
const plain = value => JSON.parse(JSON.stringify(value, (_key, v) => ArrayBuffer.isView(v) ? Array.from(v) : v));

export async function dumpCloth({ rig: source, destination }) {
  const sequences = [], originalRandom = Math.random;
  try {
    for (const variant of ['legacy', 'custom', 'tiers', 'seams', 'zero', 'empty', 'legs', 'subpixel', 'one-pixel', 'two-pixel', 'mixed', 'zero-parent']) {
      const rig = clothRig(source, variant); const engine = createRig(rig);
      Math.random = seededRandom(173);
      const { Physics } = createPhysics(engine, rig), physics = new Physics();
      const motion = new Motion(rig.view.gazeCenter ?? [rig.head.cx, rig.head.cy], !!rig.legs, rig.arms ? rig : null);
      const { Cloth, garments } = createCloth(engine, rig), cloth = new Cloth();
      const { buildGrid } = createRenderer(engine, rig);
      const meshes = rig.cloth.map(c => {
        const xs = c.outline.map(p => p[0]), ys = c.outline.map(p => p[1]);
        const rect = [Math.min(...xs)-20, Math.min(...ys)-20, Math.max(...xs)-Math.min(...xs)+40, Math.max(...ys)-Math.min(...ys)+40];
        const mesh = buildGrid(rect, 23, new Uint8Array([255]), 1);
        cloth.attach(c.name, mesh); return { name: c.name, mesh };
      });
      const initial = garments.map(g => ({ grid: plain(g.grid), gravity: g.gravity, rest: plain(g.rest), tuning: plain(g.tuning) }));
      const actions = [[20, null, { responseGain: 2, tierGain: 3, highModeDamping: 0.48 }],
        [100, 'skirt', { stiffness: 0.7, swing: 1.2, damping: 1.4, follow: 0.7, wind: 0.2, cohesion: 0, max: 30 }],
        [200, null, { responseGain: 0.8, tierGain: 1.2, highModeDamping: 1.5 }]];
      const longTrace = ['zero', 'subpixel', 'one-pixel', 'two-pixel', 'mixed', 'zero-parent'].includes(variant);
      const samples = [], frames = longTrace ? 1800 : 360;
      for (let frame = 0; frame < frames; frame++) {
        if (variant !== 'empty') for (const [at, name, tune] of actions) if (frame === at) cloth.setTuning(name, tune);
        const dt = frame === 40 ? 0 : frame === 80 ? -0.1 : frame === 120 ? 0.08 : 1/60;
        cloth.gain = frame < 180 ? 1 : frame < 240 ? 0 : 2;
        const p = motion.update(Math.max(0, dt)); const phys = physics.step(p, Math.max(0, dt));
        cloth.step(p, dt, phys);
        cloth.deform();
        for (const g of garments) for (const values of [g.out, g.physicalOut, g.target, g.angle, g.angularVelocity,
          g.lowerAngle, g.lowerAngularVelocity, g.bounce, g.bounceVelocity]) {
          if (!values.every(Number.isFinite)) throw new Error(`${variant}: non-finite cloth state at frame ${frame}`);
        }
        for (const { mesh } of meshes) if (!mesh.pos.every(Number.isFinite)) throw new Error(`${variant}: non-finite cloth mesh at frame ${frame}`);
        samples.push({ frame, dt, parameters: { ...p }, gain: cloth.gain, time: cloth.time,
          garments: garments.map(g => plain({ out: g.out, physicalOut: g.physicalOut, target: g.target,
            angle: g.angle, angularVelocity: g.angularVelocity, lowerAngle: g.lowerAngle, lowerAngularVelocity: g.lowerAngularVelocity,
            bounce: g.bounce, bounceVelocity: g.bounceVelocity, pendulums: g.pendulums })), positions: meshes.map(m => Array.from(m.mesh.pos)) });
      }
      sequences.push({ variant, rig, ...(longTrace ? { longTrace: true } : {}), actions: variant === 'empty' ? [] : actions, initial, meshes: meshes.map(m => ({name:m.name,mesh:plain(m.mesh)})), samples, nextRandom: Math.random() });
    }
  } finally { Math.random = originalRandom; }
  const validation = [];
  const check = (label, edit) => { const rig = clothRig(source); edit(rig); validation.push({label,rig,valid:validateRig(rig).length === 0}); };
  check('defaults', r => { for (const key of ['columns','rows','wind','max','responseGain','follow']) delete r.cloth[0][key]; });
  check('empty lines', r => { r.cloth[0].seams=[]; r.cloth[0].tiers=[]; });
  for (const [key,value] of Object.entries({columns:1,rows:1,parent:'later',swing:0,stiffness:0,damping:-1,max:0,follow:1.1,wind:-1,cohesion:1.5,scale:0,responseGain:0,tierGain:0,highModeDamping:0,name:'../bad'})) check(key,r=>r.cloth[0][key]=value);
  for (const key of ['columns','rows','seams','tiers','parent','behind','scale','wind','responseGain']) check(`${key}-null`,r=>r.cloth[0][key]=null);
  check('duplicate',r=>r.cloth[1].name='skirt'); check('self-parent',r=>r.cloth[0].parent='skirt');
  check('cell-zero',r=>r.mesh.clothCell=0); check('cell-null',r=>r.mesh.clothCell=null);
  check('tiers-reverse',r=>r.cloth[0].tiers.reverse()); check('seam-one',r=>r.cloth[0].seams.length=1);
  check('seam-flat',r=>r.cloth[0].seams[0][1][1]=880); check('crossed',r=>r.cloth[0].seams.reverse());
  check('tier-missing-crossing',r=>r.cloth[0].tiers[0]=[[0,940],[1,940]]);
  check('empty-cloth',r=>r.cloth=[]); check('null-cloth',r=>r.cloth=null);
  const systems = [[40,40],[70,25,5],[45,20,15,10]].map(lengths => {
    const s = pendulumSystem(lengths,4903.325,0.25,0.48); s.angles = lengths.map((_,i)=>0.12*(i%2?-1:1));
    const initial = plain(s), samples=[];
    for(let i=0;i<2400;i++) { stepPendulum(s,1/480); if(i%40===0||i===2399) samples.push({frame:i,state:plain(s),energy:pendulumEnergy(s)}); }
    return {initial,samples};
  });
  await writeFile(new URL('cloth.json',destination),JSON.stringify({sequences,validation,systems})+'\n');
  console.log(`Wrote ${sequences.length} cloth sequences, ${validation.length} validation cases and ${systems.length} free pendulums`);
}
