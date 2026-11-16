import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RaceSteering} from '../lib/race-steering.ts';

test('new drivers must select controls; buttons are ready without sensor permission',()=>{
  const steering=new RaceSteering();assert.equal(steering.getSnapshot().canPrepare,false);
  steering.observe(20);assert.equal(steering.getSnapshot().mode,null);
  steering.useButtons();assert.equal(steering.getSnapshot().canPrepare,true);
  steering.observe(45);assert.equal(steering.readSteer(),0);
});

test('permission alone is insufficient; finite orientation data calibrates relative steering',async()=>{
  const steering=new RaceSteering();await steering.useSensor(async()=>'granted');
  assert.equal(steering.getSnapshot().canPrepare,false);
  for(const bad of [null,NaN,Infinity,91])steering.observe(bad);
  assert.equal(steering.getSnapshot().status,'calibrating');
  steering.observe(12);assert.equal(steering.getSnapshot().canPrepare,true);assert.equal(steering.readSteer(),0);
  steering.observe(23);assert.equal(steering.readSteer(),.5);
  steering.observe(-40);assert.equal(steering.readSteer(),-1);
  steering.useButtons();assert.equal(steering.readSteer(),0);
});

test('denied or unavailable sensors leave readiness blocked and allow explicit button fallback',async()=>{
  for(const permission of [async()=>'denied',async()=>{throw new Error('设备不支持体感');}]){
    const steering=new RaceSteering();await steering.useSensor(permission);
    assert.equal(steering.getSnapshot().status,'error');assert.equal(steering.getSnapshot().canPrepare,false);
    steering.observe(0);assert.equal(steering.getSnapshot().canPrepare,false);
    steering.useButtons();assert.equal(steering.getSnapshot().canPrepare,true);
  }
});

test('late permission responses cannot switch back from selected buttons',async()=>{
  for(const response of ['granted','denied']){
    const steering=new RaceSteering();let finish!:(value:string)=>void;
    const pending=steering.useSensor(()=>new Promise(resolve=>{finish=resolve;}));
    assert.equal(steering.getSnapshot().status,'requesting');steering.useButtons();
    finish(response);await pending;
    assert.equal(steering.getSnapshot().mode,'buttons');assert.equal(steering.getSnapshot().canPrepare,true);
  }
});

test('missing sensor data times out and retry requires fresh calibration',async()=>{
  const steering=new RaceSteering();await steering.useSensor(async()=>'granted',5);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(steering.getSnapshot().status,'error');steering.observe(12);
  assert.equal(steering.getSnapshot().canPrepare,false);
  await steering.useSensor(async()=>'granted');steering.observe(30);steering.observe(41);
  assert.equal(steering.readSteer(),.5);
  const retry=steering.useSensor(async()=>'granted');assert.equal(steering.readSteer(),0);
  await retry;assert.equal(steering.getSnapshot().canPrepare,false);
  steering.observe(41);assert.equal(steering.readSteer(),0);assert.equal(steering.getSnapshot().canPrepare,true);
});

test('restored ready players get labelled working buttons rather than a stale sensor calibration',()=>{
  const steering=new RaceSteering(true);
  assert.equal(steering.getSnapshot().mode,'buttons');assert.equal(steering.getSnapshot().canPrepare,true);
  assert.match(steering.getSnapshot().message,/体感需要重新开启/);
  steering.observe(22);assert.equal(steering.readSteer(),0);
});

test('leaving during permission request ignores subsequent permission and orientation callbacks',async()=>{
  const steering=new RaceSteering();let finish!:(value:string)=>void;
  const pending=steering.useSensor(()=>new Promise(resolve=>{finish=resolve;}));
  steering.dispose();finish('granted');await pending;
  steering.observe(0);assert.equal(steering.getSnapshot().canPrepare,false);
});
