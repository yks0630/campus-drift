import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {advance,actualSpeed,initialState,nitroMultiplier,step,trackObject} from '../lib/race-sim.ts';
import {gameAction,roomSnapshot} from '../lib/race-service.ts';

function database(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../drizzle/0000_youthful_iron_monger.sql',import.meta.url),'utf8'));
  function prepare(query:string){let args:unknown[]=[];
    return {bind(...values:unknown[]){args=values;return this;},
      async first(){return sql.prepare(query).get(...args as any[])||null;},
      async all(){return {results:sql.prepare(query).all(...args as any[])};},
      async run(){const r=sql.prepare(query).run(...args as any[]);return {meta:{changes:Number(r.changes)}};}};
  }
  return {prepare,async batch(statements:any[]){const out=[];for(const s of statements)out.push(await s.run());return out;}} as unknown as D1Database;
}
test('idle cruise reaches 30; held acceleration reaches 120 in eight seconds; release returns to 30',()=>{
  const idle=initialState();idle.nextObject=10000;advance(idle,120,[],1);assert.equal(idle.base,30);
  const s=initialState();s.nextObject=10000;
  advance(s,480,[{tick:0,throttle:true,drift:false,steer:0}],1);assert.equal(s.base,120);
  advance(s,660,[{tick:480,throttle:false,drift:false,steer:0}],1);assert.equal(s.base,30);
});
test('nitro and obstacle multiply, expire independently, and nitro fades over two seconds',()=>{
  const s=initialState();Object.assign(s,{tick:100,base:120,nitroUntil:280,hitUntil:280});
  assert.equal(actualSpeed(s),78);s.tick=280;assert.equal(actualSpeed(s),156);
  s.tick=340;assert.ok(Math.abs(actualSpeed(s)-138)<1e-9);
  s.tick=400;assert.equal(actualSpeed(s),120);
  Object.assign(s,{base:30,hitUntil:600,nitroUntil:-120});assert.equal(actualSpeed(s),15);
});
test('a second nitro refreshes the three seconds without stacking the multiplier',()=>{
  const s=initialState(),obj=trackObject(1,47);
  Object.assign(s,{tick:60,base:60,distance:obj.distance-.01,x:obj.x,nextObject:1,nitroUntil:90});
  step(s,47);assert.equal(s.pickups,1);assert.equal(s.nitroUntil-s.tick,180);assert.equal(nitroMultiplier(s),1.3);
});
test('one collider is consumed once and replayed controls are deterministic',()=>{
  const a=initialState(),b=initialState(),events=[{tick:0,throttle:true,drift:false,steer:.4},{tick:123,throttle:false,drift:true,steer:-.5}];
  advance(a,180,events,47);advance(a,360,[],47);advance(b,360,events,47);assert.deepEqual(a,b);
  const c=initialState(),object=trackObject(0,47);
  Object.assign(c,{base:60,distance:object.distance-.01,x:object.x});
  step(c,47);const expiry=c.hitUntil;advance(c,c.tick+3,[],47);
  assert.equal(c.hits,1);assert.equal(c.hitUntil,expiry);
});
test('100 players, capacity, host permissions, clock checks, authoritative distance, finish and reset',async()=>{
  const db=database(),t=1000000;
  const created:any=await gameAction(db,{action:'create'},t),code=created.room.code;
  await assert.rejects(()=>gameAction(db,{action:'start',code,hostToken:'forged'},t),/主持/);
  await assert.rejects(()=>gameAction(db,{action:'start',code,hostToken:created.hostToken},t),/至少/);
  const joined:any[]=await Promise.all(Array.from({length:100},(_,i)=>gameAction(db,{action:'join',code,name:'车手'+i,color:'blue'},t)));
  await assert.rejects(()=>gameAction(db,{action:'join',code,name:'第101人'},t),/房间已满/);
  const start:any=await gameAction(db,{action:'start',code,hostToken:created.hostToken},t);
  const at=start.room.startAt;assert.equal(at,t+5000);
  await assert.rejects(()=>gameAction(db,{action:'input',code,token:joined[0].token,round:1,until:3600,events:[]},at+500),/时钟/);
  const expected=initialState();
  const beginning=performance.now();
  for(let tick=30;tick<=3600;tick+=30){
    const events=tick===30?[{tick:0,throttle:true,drift:false,steer:0}]:[];
    advance(expected,tick,events,start.room.seed);
    await Promise.all(joined.map(p=>gameAction(db,{action:'input',code,token:p.token,round:1,until:tick,events,distance:99999999},at+tick/60*1000+20)));
  }
  const result:any=await roomSnapshot(db,code,at+65001);
  assert.equal(result.room.phase,'finished');assert.equal(result.count,100);
  assert.equal(result.players[0].distance,expected.distance);assert.ok(result.players[0].distance<2700);
  const resume:any=await gameAction(db,{action:'resume',code,token:joined[0].token},at+65001);
  assert.equal(resume.state.tick,3600);assert.equal(resume.state.distance,expected.distance);
  await gameAction(db,{action:'reset',code,hostToken:created.hostToken},at+66000);
  const next:any=await roomSnapshot(db,code,at+66001);assert.equal(next.room.round,2);assert.equal(next.players[0].distance,0);
  await assert.rejects(()=>gameAction(db,{action:'input',code,token:joined[0].token,round:1,until:30,events:[]},at+66001),/轮次/);
  console.log(JSON.stringify({players:100,requests:12000,simulatedSeconds:60,elapsedMs:Math.round(performance.now()-beginning),distance:expected.distance}));
});
