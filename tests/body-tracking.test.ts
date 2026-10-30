import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ArmPose, BodyPose, readArm, readBody, mapBody, type BodyResult } from '../src/live/body-tracking';
import { FacePose, type FaceResult } from '../src/live/tracking';
const options = { mirror: false, sensitivity: 1, smoothing: 0, bodyTracking: true };
const point = (x: number, y: number, visibility = 1) => ({ x, y, visibility, presence: 1 });
const body = (shift = 0, hipShift = shift, hipsVisible = true): BodyResult => ({ aspect: 4 / 3,
  shoulders: [point(.35 + shift, .3), point(.65 + shift, .3)], hips: [point(.4 + hipShift, .7, hipsVisible ? 1 : 0), point(.6 + hipShift, .7, hipsVisible ? 1 : 0)] });
const face = (b?: BodyResult | null): FaceResult => ({ faceLandmarks: [[]], faceBlendshapes: [], facialTransformationMatrixes: [{ data: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] }], ...(b !== undefined ? { body: b } : {}) });
test('shoulder displacement/tilt map independently, hips take weight priority, mirror and gain apply', () => {
  const zero = readBody(body())!;
  const shifted = readBody(body(.06, -.03))!;
  const normal = mapBody(shifted, zero, options), mirror = mapBody(shifted, zero, { ...options, mirror: true });
  expect(normal.bodyAngleX).toBeCloseTo(4); expect(normal.weightShift).toBeCloseTo(-.14);
  expect(mirror.bodyAngleX).toBeCloseTo(-normal.bodyAngleX); expect(mirror.weightShift).toBeCloseTo(-normal.weightShift);
  expect(mapBody(shifted, zero, { ...options, sensitivity: 2 }).bodyAngleX).toBeCloseTo(8);
  expect(mapBody(readBody(body(1))!, zero, options).bodyAngleX).toBe(10);
  const seated = mapBody(readBody(body(.06, -.03, false))!, zero, options); expect(seated.weightShift).toBeCloseTo(.28);
  const tilted = body(); tilted.shoulders[1].y += .04;
  expect(mapBody(readBody(tilted)!, zero, options).bodyAngleZ).toBeGreaterThan(5);
  expect(mapBody(readBody(tilted)!, zero, { ...options, mirror: true }).bodyAngleZ).toBeLessThan(-5);
  tilted.shoulders[0].visibility = .1; expect(readBody(tilted)).toBeNull();
  tilted.shoulders[0].visibility = 1; tilted.shoulders[0].x = NaN; expect(readBody(tilted)).toBeNull();
});
test('body neutral calibration, stale/lost/off fade, and late hip visibility stay continuous', () => {
  const pose = new BodyPose(); pose.update(body(), 0); pose.sample(0, .2, options); pose.update(body(.06, .06, false), 10);
  expect(pose.sample(10, .2, options).params.weightShift).toBeCloseTo(.28);
  pose.calibrate(10); expect(pose.sample(10, .2, options).params.bodyAngleX).toBe(0);
  pose.update(body(.09, .09), 20); const active = pose.sample(20, .2, options);
  expect(active.params.weightShift).toBeCloseTo(.14);
  pose.reset();
  const off = pose.sample(21, .016, { ...options, bodyTracking: false }); expect(off.weight).toBeLessThan(active.weight); expect(off.weight).toBeGreaterThan(0);
  expect(pose.sample(600, .016, options).active).toBe(false);
  pose.update(null, 601); for (let i = 0; i < 100; i++) pose.sample(602+i*16, .016, options);
  expect(pose.sample(3000, .016, options).weight).toBe(0); expect(pose.calibrate(3000)).toBe(false);
});
test('face-only output stays identical when body is off; body overrides rather than adds and fades weight separately', () => {
  const a = new FacePose(), b = new FacePose(); a.update(face(body()), 0); b.update(face(), 0);
  expect(a.sample(1, .016, { ...options, bodyTracking: false })).toEqual(b.sample(1, .016, { ...options, bodyTracking: false }));
  a.sample(1, 1, options); const turned=face(body(.06)); const yaw=Math.PI/6;turned.facialTransformationMatrixes[0].data=[Math.cos(yaw),0,-Math.sin(yaw),0,0,1,0,0,Math.sin(yaw),0,Math.cos(yaw),0,0,0,0,1];a.update(turned, 10); const active = a.sample(10, 1, options);
  expect(active.params.bodyAngleX).toBeCloseTo(4, 1); expect(active.parameterWeights.weightShift).toBeGreaterThan(.99);
  const lost = a.sample(600, .016, options); expect(lost.parameterWeights.weightShift).toBeGreaterThan(0); expect(lost.parameterWeights.weightShift).toBeLessThan(1);
  for (let i = 0; i < 100; i++) a.sample(700+i*16, .016, options);
  expect(a.sample(3000,.016,options).params.weightShift).toBeUndefined();
});
interface Budget { mode: string; sample(ms: number, pose: boolean, now: number): string | null }
function budget(): Budget {
  const self: { TrackingBudget?: new () => Budget } = {};
  runInNewContext(readFileSync('src/live/tracking-budget.js','utf8'), { self }); return new self.TrackingBudget!();
}
test('body-on budget uses amortized total, two bad windows, trial improvement and cooldown', () => {
  for (const improve of [false, true]) {
    const b = budget(); let now = 0, decision: string | null = null;
    for (let i = 0; i < 200 && decision !== 'tryCPU'; i++) { now += 50; decision = b.sample(i % 2 ? 20 : 70, i % 2 === 0, now); }
    expect(decision).toBe('tryCPU');
    decision = null;
    for (let i = 0; i < 100 && !decision; i++) { now += improve ? 33.3 : 90; decision = b.sample(improve ? 20 : 80, i % 2 === 0, now); }
    expect(decision).toBe(improve ? 'keepCPU' : 'restoreGPU');
    for (let i=0;i<100;i++) expect(b.sample(100,true,now+i*50)).toBeNull();
  }
  const fast = budget(); for(let i=0;i<200;i++) expect(fast.sample(20,i%2===0,i*34)).toBeNull();
});

test('worker leaves Pose unloaded when off, runs every second frame when on, returns eight numeric joints and closes frames', async () => {
  const { createContext, runInContext } = await import('node:vm');
  let poseLoads=0, poseCalls=0, closes=0, poseCloses=0, clock=0, rejectPose=false;
  const messages: {type:string; result?:{body?:BodyResult}}[]=[];
  const self: Record<string, unknown> = { location:{href:'http://127.0.0.1/mediapipe/tracking-worker.js'}, postMessage:(m:typeof messages[number])=>messages.push(m),setInterval:()=>0 };
  const context=createContext({self,URL,performance:{now:()=>clock},console});
  self.importScripts=(url:string)=>{
    if(url.endsWith('tracking-budget.js')) runInContext(readFileSync('src/live/tracking-budget.js','utf8'),context);
    else self.exports={ FilesetResolver:{forVisionTasks:async()=>({})},
      FaceLandmarker:{createFromOptions:async()=>({setOptions:async()=>{},detectForVideo:()=>face()})},
      PoseLandmarker:{createFromOptions:async()=>{poseLoads++;if(rejectPose)throw new Error('optional model unavailable');return {close:()=>poseCloses++,setOptions:async()=>{},detectForVideo:()=>{poseCalls++;return {landmarks:[Array.from({length:33},(_, i)=>point(i / 100,.4))]};}};} } };
  };
  runInContext(readFileSync('src/live/tracking-worker.js','utf8'),context);
  const send=self.onmessage as (event:{data:Record<string,unknown>})=>Promise<void>;
  await send({data:{type:'init'}});
  async function frame(){clock+=34;await send({data:{type:'frame',timestamp:clock,frame:{displayWidth:640,displayHeight:480,close:()=>closes++}}});}
  await frame();await frame();expect(poseLoads).toBe(0);expect(messages.filter(m=>m.type==='result').at(-1)?.result?.body).toBeUndefined();
  await send({data:{type:'body',enabled:true}});for(let i=0;i<8;i++)await frame();
  expect(poseLoads).toBe(1);expect(poseCalls).toBe(4);expect(closes).toBe(10);
  const bodyMessages=messages.filter(m=>m.type==='result'&&m.result?.body);
  expect(bodyMessages).toHaveLength(4);expect(Object.keys(bodyMessages[0].result!.body!)).toEqual(['shoulders','hips','elbows','wrists','aspect']);
  expect(bodyMessages[0].result!.body!.shoulders).toHaveLength(2);expect(bodyMessages[0].result!.body!.hips).toHaveLength(2);
  const joints = bodyMessages[0].result!.body!;
  expect(joints.elbows?.map(p => p.x)).toEqual([.13, .14]); expect(joints.wrists?.map(p => p.x)).toEqual([.15, .16]);
  for (const pair of [joints.shoulders, joints.hips, joints.elbows!, joints.wrists!]) for (const p of pair) {
    expect(Object.keys(p)).toEqual(['x', 'y', 'visibility', 'presence']); expect(Object.values(p).every(v => typeof v === 'number')).toBe(true);
  }
  await send({data:{type:'body',enabled:false}});await frame();expect(poseCloses).toBe(1);expect(poseCalls).toBe(4);expect(closes).toBe(11);
  rejectPose=true;await send({data:{type:'body',enabled:true}});await frame();expect(poseLoads).toBe(2);expect(messages.filter(m=>m.type==='result').at(-1)?.result?.body).toBeNull();
  expect(messages.filter(m=>m.type==='error')).toEqual([]);
});

test('body-off waits for an in-flight CPU trial before closing the model and restores the face delegate', async () => {
  const {createContext,runInContext}=await import('node:vm');
  let releaseCPU!:()=>void, enterCPU!:()=>void, closed=0, frameClosed=0;
  const cpuEntered=new Promise<void>(r=>enterCPU=r),cpuRelease=new Promise<void>(r=>releaseCPU=r);
  const delegates:string[]=[];const messages:{type:string;delegate?:string}[]=[];
  const self:Record<string,unknown>={location:{href:'http://127.0.0.1/mediapipe/tracking-worker.js'},postMessage:(m:typeof messages[number])=>messages.push(m),setInterval:()=>0};
  const context=createContext({self,URL,performance:{now:()=>34}});
  self.importScripts=(url:string)=>{
    if(url.endsWith('tracking-budget.js')) self.TrackingBudget=class { reset(){} sample(){return 'tryCPU';} };
    else self.exports={FilesetResolver:{forVisionTasks:async()=>({})},
      FaceLandmarker:{createFromOptions:async()=>({detectForVideo:()=>face(),setOptions:async(o:{baseOptions:{delegate:string}})=>{const d=o.baseOptions.delegate;if(d==='CPU'){enterCPU();await cpuRelease;}delegates.push(d);}})},
      PoseLandmarker:{createFromOptions:async()=>({close:()=>closed++,setOptions:async()=>{},detectForVideo:()=>({landmarks:[Array.from({length:33},(_, i)=>point(i / 100,.4))]})})}};
  };
  runInContext(readFileSync('src/live/tracking-worker.js','utf8'),context);
  const send=self.onmessage as(e:{data:Record<string,unknown>})=>Promise<void>;
  await send({data:{type:'init',bodyTracking:true}});
  const frame=send({data:{type:'frame',timestamp:34,frame:{displayWidth:640,displayHeight:480,close:()=>frameClosed++}}});
  await cpuEntered;const off=send({data:{type:'body',enabled:false}});await Promise.resolve();await Promise.resolve();expect(closed).toBe(0);
  releaseCPU();await frame;await off;
  expect(delegates).toEqual(['CPU','GPU']);expect(closed).toBe(1);expect(frameClosed).toBe(1);expect(messages.filter(m=>m.type==='error')).toEqual([]);
});

const armOptions = { ...options, armsTracking: true };
/** Anatomical left is camera-image right before mirroring. */
function armsBody(left = 0, right = 0, bendLeft = 0, bendRight = 0): BodyResult {
  const result = body(); result.shoulders.reverse();
  result.elbows = [point(0, 0), point(0, 0)]; result.wrists = [point(0, 0), point(0, 0)];
  for (const [i, angle] of [left, right].entries()) {
    const sign = i === 0 ? 1 : -1, upper = angle * sign * Math.PI / 180;
    const lower = upper - sign * [bendLeft, bendRight][i] * Math.PI / 180;
    const shoulder = result.shoulders[i];
    const elbow = point(shoulder.x + Math.sin(upper) * .2 / result.aspect, shoulder.y + Math.cos(upper) * .2);
    result.elbows[i] = elbow;
    result.wrists[i] = point(elbow.x + Math.sin(lower) * .2 / result.aspect, elbow.y + Math.cos(lower) * .2);
  }
  return result;
}
test('arm geometry corrects aspect and torso roll; raw sides map to image sides with and without Mirror', () => {
  const pose = new ArmPose(); pose.update(armsBody(), 0); pose.sample(0, 1, armOptions);
  pose.update(armsBody(45, -22.5, 90), 10);
  expect(readArm(armsBody(45, 0, 90), 0)).toMatchObject({ upper: 45 });
  expect(readArm(armsBody(45, 0, 90), 0)!.bend).toBeCloseTo(90);
  const normal = pose.sample(10, 1, armOptions);
  expect(normal.params.armSwingR).toBeCloseTo(1); expect(normal.params.armSwingL).toBeCloseTo(-.5);
  expect(normal.params.elbowBendR).toBeCloseTo(.6); expect(normal.params.elbowBendL).toBe(0);
  const mirrored = pose.sample(10, 1, { ...armOptions, mirror: true });
  expect(mirrored.params.armSwingL).toBe(normal.params.armSwingR);
  expect(mirrored.params.armSwingR).toBe(normal.params.armSwingL);
  expect(mirrored.params.elbowBendL).toBe(normal.params.elbowBendR);
  expect(pose.sample(10, 1, { ...armOptions, sensitivity: .5 }).params.armSwingR).toBeCloseTo(.5);
  expect(pose.sample(10, 1, { ...armOptions, sensitivity: 2 }).params.elbowBendR).toBe(.75);
  pose.update(armsBody(110, 0, 0), 20); expect(pose.sample(20, 1, armOptions).params.armSwingR).toBe(1);
  // Rotate the whole torso and arm together; local upper-arm angle stays neutral.
  const rotated = armsBody(), center = { x: .5, y: .3 }, angle = .2;
  for (const pair of [rotated.shoulders, rotated.elbows!, rotated.wrists!]) for (const p of pair) {
    const x = (p.x - center.x) * rotated.aspect, y = p.y - center.y;
    p.x = center.x + (x * Math.cos(angle) - y * Math.sin(angle)) / rotated.aspect;
    p.y = center.y + x * Math.sin(angle) + y * Math.cos(angle);
  }
  expect(readArm(rotated, 0)!.upper).toBeCloseTo(0, 10);
});
test('arm visibility holds for 500 ms and fades over 200 ms independently by side and joint', () => {
  const pose = new ArmPose(); pose.update(armsBody(), 0); pose.sample(0, 2, armOptions);
  pose.update(armsBody(45, 20, 90, 30), 10); pose.sample(10, 2, armOptions);
  const partial = armsBody(45, 20, 90, 30); partial.wrists![0].visibility = .1; partial.elbows![1].presence = .1;
  pose.update(partial, 400);
  const held = pose.sample(500, .01, armOptions); expect(held.weights.elbowBendR).toBeGreaterThan(.99);
  const faded = pose.sample(511, .2, armOptions);
  expect(faded.weights.armSwingR).toBeGreaterThan(.99);
  expect(faded.weights.elbowBendR).toBeCloseTo(Math.exp(-1), 3);
  expect(faded.weights.armSwingL).toBeCloseTo(Math.exp(-1), 3);
  expect(faded.weights.elbowBendL).toBeCloseTo(Math.exp(-1), 3);
  const bad = armsBody(); bad.elbows![0].x = NaN; bad.wrists![1] = { ...bad.elbows![1] };
  expect(readArm(bad, 0)).toBeNull(); expect(readArm(bad, 1)?.bend).toBeUndefined();
  for (let i = 0; i < 100; i++) pose.sample(1000 + i * 16, .016, armOptions);
  expect(pose.sample(3000, .1, armOptions).params).toEqual({});
});
test('arm calibration resets visible channels and late wrists start at neutral; smoothing is time based', () => {
  const pose = new ArmPose(), initial = armsBody(); delete initial.wrists;
  pose.update(initial, 0); pose.sample(0, 1, armOptions);
  pose.update(armsBody(30, 0, 60), 10);
  expect(pose.sample(10, 1, armOptions).params.elbowBendR).toBe(0);
  pose.update(armsBody(45, 0, 90), 20);
  expect(pose.sample(20, 1, armOptions).params.elbowBendR).toBeCloseTo(.2);
  expect(pose.calibrate(20)).toBe(true);
  const zero = pose.sample(20, 1, armOptions).params;
  expect(Object.values(zero).every(v => v === 0)).toBe(true);
  pose.update(armsBody(45, 0, 30), 30); expect(pose.sample(30, 1, armOptions).params.elbowBendR).toBe(0);
  const run = (steps: number) => {
    const p = new ArmPose(); p.update(armsBody(), 0); p.sample(0, 1, armOptions); p.update(armsBody(45), 1);
    let result = p.sample(1, 0, { ...armOptions, smoothing: .8 });
    for (let i = 0; i < steps; i++) result = p.sample(1, .1 / steps, { ...armOptions, smoothing: .8 });
    return result.params.armSwingR;
  };
  expect(run(1)).toBeCloseTo(run(2), 12); expect(run(1)).toBeGreaterThan(0); expect(run(1)).toBeLessThan(1);
  pose.reset(); expect(pose.calibrate(40)).toBe(false); expect(pose.sample(40, 1, armOptions).params).toEqual({});
});
test('FacePose forwards arm weights to idle without double fading; unsupported avatars retain legacy output', () => {
  const a = new FacePose(), b = new FacePose();
  a.update(face(armsBody()), 0); b.update(face(body()), 0);
  expect(a.sample(0, .2, options)).toEqual(b.sample(0, .2, options));
  a.sample(0, 2, armOptions);
  a.update(face(armsBody(45, 0, 90)), 10);
  const tracked = a.sample(10, 2, armOptions);
  expect(tracked.params.elbowBendR).toBeCloseTo(.6); expect(tracked.parameterWeights.armSwingR).toBeGreaterThan(.99);
  const lost = a.sample(511, .2, armOptions);
  expect(lost.weight * lost.parameterWeights.armSwingR).toBeCloseTo(Math.exp(-1), 3);
  a.calibrate(511); // stale arms lose their old neutral on recalibration
  a.update(face(armsBody(20, 0, 40)), 600);
  expect(a.sample(600, 1, armOptions).params.armSwingR).toBe(0);
  const disabled = a.sample(601, .2, { ...armOptions, bodyTracking: false });
  expect(disabled.parameterWeights.armSwingR).toBeLessThan(1);
});
