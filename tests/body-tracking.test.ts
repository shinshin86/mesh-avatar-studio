import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { BodyPose, readBody, mapBody, type BodyResult } from '../src/live/body-tracking';
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

test('worker leaves Pose unloaded when off, runs every second frame when on, returns only four numeric joints and closes frames', async () => {
  const { createContext, runInContext } = await import('node:vm');
  let poseLoads=0, poseCalls=0, closes=0, poseCloses=0, clock=0, rejectPose=false;
  const messages: {type:string; result?:{body?:BodyResult}}[]=[];
  const self: Record<string, unknown> = { location:{href:'http://127.0.0.1/mediapipe/tracking-worker.js'}, postMessage:(m:typeof messages[number])=>messages.push(m),setInterval:()=>0 };
  const context=createContext({self,URL,performance:{now:()=>clock},console});
  self.importScripts=(url:string)=>{
    if(url.endsWith('tracking-budget.js')) runInContext(readFileSync('src/live/tracking-budget.js','utf8'),context);
    else self.exports={ FilesetResolver:{forVisionTasks:async()=>({})},
      FaceLandmarker:{createFromOptions:async()=>({setOptions:async()=>{},detectForVideo:()=>face()})},
      PoseLandmarker:{createFromOptions:async()=>{poseLoads++;if(rejectPose)throw new Error('optional model unavailable');return {close:()=>poseCloses++,setOptions:async()=>{},detectForVideo:()=>{poseCalls++;return {landmarks:[Array.from({length:33},()=>point(.5,.4))]};}};} } };
  };
  runInContext(readFileSync('src/live/tracking-worker.js','utf8'),context);
  const send=self.onmessage as (event:{data:Record<string,unknown>})=>Promise<void>;
  await send({data:{type:'init'}});
  async function frame(){clock+=34;await send({data:{type:'frame',timestamp:clock,frame:{displayWidth:640,displayHeight:480,close:()=>closes++}}});}
  await frame();await frame();expect(poseLoads).toBe(0);expect(messages.filter(m=>m.type==='result').at(-1)?.result?.body).toBeUndefined();
  await send({data:{type:'body',enabled:true}});for(let i=0;i<8;i++)await frame();
  expect(poseLoads).toBe(1);expect(poseCalls).toBe(4);expect(closes).toBe(10);
  const bodyMessages=messages.filter(m=>m.type==='result'&&m.result?.body);
  expect(bodyMessages).toHaveLength(4);expect(Object.keys(bodyMessages[0].result!.body!)).toEqual(['shoulders','hips','aspect']);
  expect(bodyMessages[0].result!.body!.shoulders).toHaveLength(2);expect(bodyMessages[0].result!.body!.hips).toHaveLength(2);
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
      PoseLandmarker:{createFromOptions:async()=>({close:()=>closed++,setOptions:async()=>{},detectForVideo:()=>({landmarks:[Array.from({length:33},()=>point(.5,.4))]})})}};
  };
  runInContext(readFileSync('src/live/tracking-worker.js','utf8'),context);
  const send=self.onmessage as(e:{data:Record<string,unknown>})=>Promise<void>;
  await send({data:{type:'init',bodyTracking:true}});
  const frame=send({data:{type:'frame',timestamp:34,frame:{displayWidth:640,displayHeight:480,close:()=>frameClosed++}}});
  await cpuEntered;const off=send({data:{type:'body',enabled:false}});await Promise.resolve();await Promise.resolve();expect(closed).toBe(0);
  releaseCPU();await frame;await off;
  expect(delegates).toEqual(['CPU','GPU']);expect(closed).toBe(1);expect(frameClosed).toBe(1);expect(messages.filter(m=>m.type==='error')).toEqual([]);
});
