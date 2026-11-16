import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {advance,actualSpeed,initialState,nitroMultiplier,step,trackObject,TRACK_CONFIG,roadPosition,roadCurve,roadCenterOffset,trackBounds,objectContact,speedZoom} from '../lib/race-sim.ts';
import {gameAction,roomSnapshot,roundResult,ONLINE_WINDOW_MS} from '../lib/race-service.ts';
import {formatDistance,resultsCsv} from '../lib/race-ranking.ts';
import {acceptReadiness,releasedControl,restoredControl,sampleControl,requestGame} from '../lib/race-client.ts';

function database(){
  const sql=new DatabaseSync(':memory:');
  const migrations=new URL('../drizzle/',import.meta.url);
  for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(file,migrations),'utf8'));
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

test('road edges stop outward drift but steering back moves the car away from the edge',()=>{
  for(const direction of [-1,1]){
    const s=initialState();s.base=120;s.nextObject=10000;s.control={throttle:true,drift:true,steer:direction};
    advance(s,300,[],47);
    const before=s.x,bounds=trackBounds(s.distance,s.driftAngle);
    assert.ok(s.x>=bounds.min&&s.x<=bounds.max);assert.ok(Math.abs(s.lateralVelocity!)<.01);
    s.control.steer=-direction;advance(s,360,[],47);
    assert.ok((s.x-before)*direction<-.1);
  }
});

function assertBodyOnRoad(s:ReturnType<typeof initialState>){
  const width=TRACK_CONFIG.carWidthRatio,height=width*TRACK_CONFIG.carLengthRatio,angle=s.driftAngle??0;
  const unit=TRACK_CONFIG.roadWidthRatio*.4/TRACK_CONFIG.halfWidth;
  for(const zoom of [1,1.5,1.65])for(const side of [-1,1])for(const end of [-1,1]){
    const x=side*width/2,y=end*height/2;
    const cornerX=s.x*unit+x*Math.cos(angle)-y*Math.sin(angle);
    const cornerY=x*Math.sin(angle)+y*Math.cos(angle);
    const centre=roadCenterOffset(s.distance,-cornerY*TRACK_CONFIG.metresPerViewWidth/zoom);
    assert.ok(Math.abs(cornerX-centre)<=TRACK_CONFIG.roadWidthRatio*TRACK_CONFIG.asphaltWidthRatio/2+1e-8,
      `body left the road at tick ${s.tick}, x=${s.x}, zoom=${zoom}`);
  }
}

test('the full rotated car stays on the road through bends, nitro and held steering',()=>{
  for(const direction of [-1,1])for(const drift of [false,true]){
    const s=initialState();s.base=120;s.nitroUntil=5000;s.nextObject=10000;
    s.control={throttle:true,drift,steer:direction};
    for(let tick=0;tick<3600;tick++){step(s,47);assertBodyOnRoad(s);}
  }
});

test('old states on grass return inside the road on the next physics tick',()=>{
  for(const direction of [-1,1]){
    const s=initialState();Object.assign(s,{x:direction*1.6,base:120,distance:650,lateralVelocity:direction*2,driftAngle:direction*.8});
    s.control={throttle:true,drift:true,steer:direction};s.nextObject=10000;
    step(s,47);assertBodyOnRoad(s);
  }
});

test('sparser track reduces both hazards and nitro and keeps collisions on the visible lane',()=>{
  const counts={obstacle:0,nitro:0};
  for(let i=0;;i++){
    const obj=trackObject(i,47);if(obj.distance>1000)break;counts[obj.type]++;
    assert.ok(obj.distance>=50);assert.ok(Math.abs(obj.x)<TRACK_CONFIG.halfWidth);
  }
  // Previously one kilometre contained 23 obstacles and 11 nitro bottles.
  assert.ok(counts.obstacle<=16&&counts.obstacle>0);
  assert.ok(counts.nitro<=8&&counts.nitro>0);
  const obj=trackObject(0,47),hit=initialState(),miss=initialState();
  for(const s of [hit,miss])Object.assign(s,{base:60,distance:obj.distance-.01,x:obj.x});
  miss.x-=Math.sign(obj.x||1)*.7;
  step(hit,47);step(miss,47);
  assert.equal(hit.hits,1);assert.equal(miss.hits,0);
});

test('drift carries lateral momentum and the body gradually straightens after release',()=>{
  const s=initialState();s.base=120;s.nextObject=10000;
  advance(s,30,[{tick:0,throttle:true,drift:true,steer:.6}],47);
  const before={x:s.x,velocity:s.lateralVelocity!,angle:s.driftAngle!};
  assert.ok(before.velocity>.2);assert.ok(before.angle>.25);
  s.control.steer=0;step(s,47);
  assert.ok(s.x>before.x);assert.ok(s.lateralVelocity!>before.velocity*.7);
  const angle=s.driftAngle!;s.control.drift=false;step(s,47);
  assert.ok(s.driftAngle!>0&&s.driftAngle!<angle);
  advance(s,s.tick+60,[],47);assert.ok(s.driftAngle!<.03);
});

test('new bend forces follow the same S curve used by the rendered road',()=>{
  const positions=Array.from({length:2001},(_,d)=>roadPosition(d));
  assert.ok(Math.max(...positions)>.5&&Math.min(...positions)<-.5);
  for(const d of [0,40,110,220,500,1100]){
    const slope=(roadPosition(d+.001)-roadPosition(d-.001))/.002;
    assert.ok(Math.abs(roadCurve(d)-180*slope)<1e-7);
  }
});

test('legacy states without momentum fields and saved/reloaded drift states replay deterministically',()=>{
  const events=[{tick:0,throttle:true,drift:false,steer:0},
    {tick:120,throttle:true,drift:true,steer:.6},{tick:175,throttle:true,drift:true,steer:-.5},
    {tick:260,throttle:true,drift:false,steer:0},{tick:2100,throttle:true,drift:true,steer:.4}];
  const whole=initialState(),legacy=initialState();delete legacy.lateralVelocity;delete legacy.driftAngle;delete legacy.viewZoom;delete legacy.wallUntil;delete legacy.wallHits;
  advance(whole,3600,events,47);advance(legacy,1800,events,47);
  const restored=JSON.parse(JSON.stringify(legacy));advance(restored,3600,events.filter(e=>e.tick>=1800),47);
  assert.deepEqual(restored,whole);
});

test('authoritative input batches preserve drifting momentum and final distance',async()=>{
  const db=database(),t=1000000,created:any=await gameAction(db,{action:'create'},t),code=created.room.code;
  const p:any=await gameAction(db,{action:'join',code,name:'漂移重放'},t);
  await gameAction(db,{action:'ready',code,token:p.token,round:1,ready:true},t);
  const started:any=await gameAction(db,{action:'start',code,hostToken:created.hostToken},t);
  const events=[{tick:0,throttle:true,drift:false,steer:0},
    {tick:120,throttle:true,drift:true,steer:.6},{tick:240,throttle:true,drift:true,steer:-.5},
    {tick:330,throttle:true,drift:false,steer:0},{tick:2000,throttle:true,drift:true,steer:.4}];
  const expected=initialState();advance(expected,3600,events,started.room.seed);
  let reply:any;
  for(let tick=300;tick<=3600;tick+=300){
    reply=await gameAction(db,{action:'input',code,token:p.token,round:1,until:tick,
      events:events.filter(e=>e.tick>=tick-300&&e.tick<=tick)},started.room.startAt+tick/60*1000+10);
  }
  assert.deepEqual(reply.state,expected);
  const finished:any=await gameAction(db,{action:'resume',code,token:p.token},started.room.settleAt+1);
  assert.equal(finished.state.distance,expected.distance);assert.equal(finished.rank,1);
});
test('100 players, capacity, host permissions, clock checks, authoritative distance, finish and reset',async()=>{
  const db=database(),t=1000000;
  const created:any=await gameAction(db,{action:'create'},t),code=created.room.code;
  await assert.rejects(()=>gameAction(db,{action:'start',code,hostToken:'forged'},t),/主持/);
  await assert.rejects(()=>gameAction(db,{action:'start',code,hostToken:created.hostToken},t),/至少/);
  const joined:any[]=await Promise.all(Array.from({length:100},(_,i)=>gameAction(db,{action:'join',code,name:'车手'+i,color:'blue'},t)));
  await assert.rejects(()=>gameAction(db,{action:'join',code,name:'第101人'},t),/房间已满/);
  await Promise.all(joined.map(p=>gameAction(db,{action:'ready',code,token:p.token,round:1,ready:true},t)));
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
  assert.equal(result.room.phase,'finished');assert.equal(result.participantCount,100);
  assert.equal(result.players[0].distance,expected.distance);assert.ok(result.players[0].distance<2700);
  const resume:any=await gameAction(db,{action:'resume',code,token:joined[0].token},at+65001);
  assert.equal(resume.state.tick,3600);assert.equal(resume.state.distance,expected.distance);assert.equal(resume.rank,1);assert.equal(resume.tied,true);
  await gameAction(db,{action:'reset',code,hostToken:created.hostToken},at+66000);
  const next:any=await roomSnapshot(db,code,at+66001);assert.equal(next.room.round,2);assert.equal(next.players[0].distance,0);
  await assert.rejects(()=>gameAction(db,{action:'input',code,token:joined[0].token,round:1,until:30,events:[]},at+66001),/轮次/);
  console.log(JSON.stringify({players:100,requests:12000,simulatedSeconds:60,elapsedMs:Math.round(performance.now()-beginning),distance:expected.distance}));
});

test('readiness is shared, cancellable, required for every online player, and cleared by reset',async()=>{
  const db=database(),t=1000000,created:any=await gameAction(db,{action:'create'},t),code=created.room.code;
  const a:any=await gameAction(db,{action:'join',code,name:'甲'},t),b:any=await gameAction(db,{action:'join',code,name:'乙'},t);
  const start=()=>gameAction(db,{action:'start',code,hostToken:created.hostToken},t+100);
  await assert.rejects(start,/未准备/);
  await gameAction(db,{action:'ready',code,token:a.token,round:1,ready:true},t);
  let view=await roomSnapshot(db,code,t);assert.equal(view.readyCount,1);assert.equal(view.onlineCount,2);
  assert.equal((await gameAction(db,{action:'resume',code,token:a.token},t) as any).ready,true);
  await assert.rejects(start,/未准备/);
  await gameAction(db,{action:'ready',code,token:a.token,round:1,ready:false},t);
  assert.equal((await roomSnapshot(db,code,t)).readyCount,0);
  for(const p of [a,b])await gameAction(db,{action:'ready',code,token:p.token,round:1,ready:true},t);
  const started:any=await start();view=await roomSnapshot(db,code,t+100);assert.equal(view.participantCount,2);
  await assert.rejects(()=>gameAction(db,{action:'ready',code,token:a.token,round:1,ready:false},t+200),/状态已变化/);
  await gameAction(db,{action:'reset',code,hostToken:created.hostToken},started.room.settleAt+1);
  view=await roomSnapshot(db,code,started.room.settleAt+2);assert.equal(view.readyCount,0);assert.equal(view.participantCount,0);
  assert.ok(view.players.every(p=>!p.ready&&!p.participating&&p.distance===0));
  await assert.rejects(()=>gameAction(db,{action:'ready',code,token:a.token,round:1,ready:true},started.room.settleAt+3),/状态已变化/);
});

test('heartbeats count online players; stale readiness is cleared on reconnect and offline players do not race',async()=>{
  const db=database(),t=1000000,created:any=await gameAction(db,{action:'create'},t),code=created.room.code;
  const a:any=await gameAction(db,{action:'join',code,name:'在线'},t),b:any=await gameAction(db,{action:'join',code,name:'离线'},t);
  for(const p of [a,b])await gameAction(db,{action:'ready',code,token:p.token,round:1,ready:true},t);
  const later=t+ONLINE_WINDOW_MS;
  let view=await roomSnapshot(db,code,later);assert.equal(view.count,0);assert.equal(view.memberCount,2);assert.equal(view.readyCount,0);
  const back:any=await gameAction(db,{action:'resume',code,token:a.token},later);assert.equal(back.ready,false);assert.equal(back.count,1);
  await gameAction(db,{action:'ready',code,token:a.token,round:1,ready:true},later);
  await gameAction(db,{action:'start',code,hostToken:created.hostToken},later+1);
  view=await roomSnapshot(db,code,later+2);assert.equal(view.participantCount,1);assert.equal(view.players.length,1);assert.equal(view.players[0].id,a.player.id);
  const spectator:any=await gameAction(db,{action:'input',code,token:b.token,round:1,until:0,events:[]},later+5002);
  assert.equal(spectator.participating,false);assert.equal(spectator.state.distance,0);assert.equal(spectator.rank,0);assert.equal(spectator.count,2);
});

test('leaving and host removal update membership immediately and invalidate old sessions',async()=>{
  const db=database(),t=1000000,created:any=await gameAction(db,{action:'create'},t),code=created.room.code;
  const a:any=await gameAction(db,{action:'join',code,name:'退出'},t),b:any=await gameAction(db,{action:'join',code,name:'移除'},t);
  await gameAction(db,{action:'leave',code,token:a.token},t+1);
  let view=await roomSnapshot(db,code,t+2);assert.equal(view.count,1);assert.equal(view.memberCount,1);
  await assert.rejects(()=>gameAction(db,{action:'resume',code,token:a.token},t+3),/已退出/);
  await assert.rejects(()=>gameAction(db,{action:'remove',code,hostToken:'forged',playerId:b.player.id},t+3),/主持/);
  await gameAction(db,{action:'remove',code,hostToken:created.hostToken,playerId:b.player.id},t+3);
  view=await roomSnapshot(db,code,t+4);assert.equal(view.count,0);assert.equal(view.players.length,0);
  await assert.rejects(()=>gameAction(db,{action:'resume',code,token:b.token},t+5),/移出/);
  const c:any=await gameAction(db,{action:'join',code,name:'新加入'},t+6);assert.equal(c.count,1);
});

test('leaving mid-race preserves the result and fixed participant count while removal is blocked',async()=>{
  const db=database(),t=1000000,created:any=await gameAction(db,{action:'create'},t),code=created.room.code;
  const a:any=await gameAction(db,{action:'join',code,name:'比赛后退出'},t);
  await gameAction(db,{action:'ready',code,token:a.token,round:1,ready:true},t);
  const started:any=await gameAction(db,{action:'start',code,hostToken:created.hostToken},t);
  await assert.rejects(()=>gameAction(db,{action:'remove',code,hostToken:created.hostToken,playerId:a.player.id},t+1),/下一局准备/);
  await gameAction(db,{action:'leave',code,token:a.token},started.room.startAt+1000);
  const view=await roomSnapshot(db,code,started.room.settleAt+1);
  assert.equal(view.count,0);assert.equal(view.participantCount,1);assert.equal(view.players.length,1);assert.ok(view.players[0].distance>0);
});

test('ranking matches displayed 0.1m precision, shares places, skips places, and agrees on phone and screen',async()=>{
  const db=database(),t=1000000,created:any=await gameAction(db,{action:'create'},t),code=created.room.code;
  const joined:any[]=[];
  for(const name of ['甲','乙','丙','丁']){
    const p:any=await gameAction(db,{action:'join',code,name},t);joined.push(p);
    await gameAction(db,{action:'ready',code,token:p.token,round:1,ready:true},t);
  }
  const started:any=await gameAction(db,{action:'start',code,hostToken:created.hostToken},t);
  const distances=[100.04,100.01,99.9,99.85];
  for(let i=0;i<joined.length;i++){
    const state=initialState();Object.assign(state,{tick:3600,distance:distances[i]});
    await db.prepare('UPDATE race_players SET distance=?,state=? WHERE id=?').bind(distances[i],JSON.stringify(state),joined[i].player.id).run();
  }
  const view=await roomSnapshot(db,code,started.room.settleAt+1);
  assert.deepEqual(view.players.map(p=>p.rank),[1,1,3,3]);assert.ok(view.players.every(p=>p.tied));
  assert.deepEqual(view.players.map(p=>formatDistance(p.distance)),['100.0','100.0','99.9','99.9']);
  for(const p of joined){
    const phone:any=await gameAction(db,{action:'resume',code,token:p.token},started.room.settleAt+2);
    assert.equal(phone.rank,view.players.find(v=>v.id===p.player.id)?.rank);assert.equal(phone.tied,true);assert.equal(phone.participantCount,4);
  }
});

test('a player joining while the host starts cannot bypass the readiness gate',async()=>{
  const db=database(),t=1000000,created:any=await gameAction(db,{action:'create'},t),code=created.room.code;
  const a:any=await gameAction(db,{action:'join',code,name:'已准备'},t);
  await gameAction(db,{action:'ready',code,token:a.token,round:1,ready:true},t);
  const concurrent={...db,batch:async(statements:D1PreparedStatement[])=>{
    await gameAction(db,{action:'join',code,name:'刚入场未准备'},t+1);
    return db.batch(statements);
  }} as D1Database;
  await assert.rejects(()=>gameAction(concurrent,{action:'start',code,hostToken:created.hostToken},t+2),/准备状态已变化/);
  const view=await roomSnapshot(db,code,t+3);assert.equal(view.room.phase,'waiting');assert.equal(view.participantCount,0);assert.equal(view.memberCount,2);
});

test('migration preserves previously started players and their saved distances',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../drizzle/0000_youthful_iron_monger.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO race_rooms(code,host_hash,created_at,seed,start_at) VALUES(?,?,?,?,?)').run('123456','hash',0,47,1000);
  db.prepare('INSERT INTO race_players(id,token_hash,room,name,color,state,updated_at,distance) VALUES(?,?,?,?,?,?,?,?)')
    .run('saved','tokenhash','123456','原有车手','blue',JSON.stringify(initialState()),1000,123.4);
  db.exec(readFileSync(new URL('../drizzle/0001_easy_union_jack.sql',import.meta.url),'utf8'));
  const saved=db.prepare('SELECT distance,participating,ready,membership FROM race_players').get()!;
  assert.deepEqual({...saved},{distance:123.4,participating:1,ready:0,membership:'active'});
  db.exec(readFileSync(new URL('../drizzle/0002_real_gunslinger.sql',import.meta.url),'utf8'));
  assert.deepEqual({...db.prepare('SELECT distance,ready_version FROM race_players').get()!},{distance:123.4,ready_version:0});
  assert.equal(db.prepare('SELECT count(*) AS count FROM race_results').get()!.count,0);
});

test('reload emits released controls and authoritative replay returns from 120 to cruise',async()=>{
  const db=database(),t=1000000,host:any=await gameAction(db,{action:'create'},t),code=host.room.code;
  const player:any=await gameAction(db,{action:'join',code,name:'刷新赛车'},t);
  await gameAction(db,{action:'ready',code,token:player.token,round:1,ready:true},t);
  const start:any=await gameAction(db,{action:'start',code,hostToken:host.hostToken},t),at=start.room.startAt;
  await gameAction(db,{action:'input',code,token:player.token,round:1,until:480,
    events:[{tick:0,throttle:true,drift:true,steer:.5}]},at+8000);
  const resumed:any=await gameAction(db,{action:'resume',code,token:player.token},at+8001);
  assert.equal(resumed.state.base,120);
  const sampled=sampleControl(resumed.state.tick,restoredControl(resumed.state.control),releasedControl());
  assert.ok(sampled.event);
  const after:any=await gameAction(db,{action:'input',code,token:player.token,round:1,until:660,
    events:[sampled.event]},at+11000);
  assert.deepEqual(after.state.control,releasedControl());assert.equal(after.state.base,30);
});

test('readiness rejects stale writes and reordered responses, including previous rounds',async()=>{
  const db=database(),t=1000000,host:any=await gameAction(db,{action:'create'},t),code=host.room.code;
  const player:any=await gameAction(db,{action:'join',code,name:'弱网准备'},t);
  const ready:any=await gameAction(db,{action:'ready',code,token:player.token,round:1,readyVersion:0,ready:true},t+100);
  const cancel:any=await gameAction(db,{action:'ready',code,token:player.token,round:1,readyVersion:ready.readyVersion,ready:false},t+200);
  const stamp=(d:any)=>({round:d.room.round,readyVersion:d.readyVersion,ready:d.ready});
  assert.equal(acceptReadiness(stamp(cancel),stamp(ready)).ready,false);
  await assert.rejects(()=>gameAction(db,{action:'ready',code,token:player.token,round:1,readyVersion:ready.readyVersion,ready:true},t+300),/准备状态已更新/);
  // A heartbeat that began earlier must not move last-seen time backwards.
  const newest:any=await gameAction(db,{action:'ready',code,token:player.token,round:1,readyVersion:cancel.readyVersion,ready:true},t+20000);
  const oldHeartbeat:any=await gameAction(db,{action:'resume',code,token:player.token},t+1000);
  assert.equal(oldHeartbeat.ready,true);assert.equal(oldHeartbeat.readyVersion,newest.readyVersion);
  assert.equal((await roomSnapshot(db,code,t+20001)).onlineCount,1);
  const started:any=await gameAction(db,{action:'start',code,hostToken:host.hostToken},t+20001);
  await gameAction(db,{action:'reset',code,hostToken:host.hostToken},started.room.settleAt+1);
  const next:any=await gameAction(db,{action:'resume',code,token:player.token},started.room.settleAt+2);
  assert.equal(next.ready,false);assert.equal(next.room.round,2);
  assert.deepEqual(acceptReadiness(stamp(next),stamp(newest)),stamp(next));
});

test('reset archives final results without prior polling and preserves multiple rounds and CSV ties',async()=>{
  const db=database(),t=1000000,host:any=await gameAction(db,{action:'create'},t),code=host.room.code;
  const players:any[]=[];
  for(const name of ['甲,"同学"','=乙'])players.push(await gameAction(db,{action:'join',code,name},t));
  let now=t;
  for(let round=1;round<=2;round++){
    for(const p of players)await gameAction(db,{action:'ready',code,token:p.token,round,ready:true},now);
    const started:any=await gameAction(db,{action:'start',code,hostToken:host.hostToken},now);
    await assert.rejects(()=>gameAction(db,{action:'reset',code,hostToken:host.hostToken},started.room.settleAt-1),/结算后/);
    // Reset is the first request after the race: it must finish and save every player.
    now=started.room.settleAt+1;
    await gameAction(db,{action:'reset',code,hostToken:host.hostToken},now);
    const saved=await roundResult(db,code,round,now);
    assert.equal(saved.participantCount,2);assert.ok(saved.players.every((p:any)=>p.distance>0&&p.rank===1&&p.tied));
    assert.deepEqual(await roundResult(db,code,round,now),saved);
  }
  const view=await roomSnapshot(db,code,now);assert.deepEqual(view.history.map(r=>r.round),[2,1]);
  const saved=await roundResult(db,code,1,now);
  await gameAction(db,{action:'remove',code,hostToken:host.hostToken,playerId:players[0].player.id},now);
  assert.deepEqual((await roundResult(db,code,1,now)).players,saved.players);
  const csv=resultsCsv(saved.players);
  assert.ok(csv.startsWith('\uFEFF名次,'));assert.ok(csv.includes('"甲,""同学"""'));
  assert.ok(csv.includes('"\'=乙"'));assert.equal(csv.split('\n').length,3);
  assert.ok(csv.split('\n').slice(1).every(line=>line.startsWith('1,')&&line.endsWith(',是')));
  await assert.rejects(()=>roundResult(db,code,3,now),/尚未结算/);
});

test('archive write failure blocks reset and preserves the completed round for retry',async()=>{
  const db=database(),t=1000000,host:any=await gameAction(db,{action:'create'},t),code=host.room.code;
  const player:any=await gameAction(db,{action:'join',code,name:'保存失败重试'},t);
  await gameAction(db,{action:'ready',code,token:player.token,round:1,ready:true},t);
  const started:any=await gameAction(db,{action:'start',code,hostToken:host.hostToken},t);
  const broken={...db,prepare(query:string){
    if(query.startsWith('INSERT OR IGNORE INTO race_results'))throw new Error('archive unavailable');
    return db.prepare(query);
  }} as D1Database;
  await assert.rejects(()=>gameAction(broken,{action:'reset',code,hostToken:host.hostToken},started.room.settleAt),/archive unavailable/);
  const current:any=await db.prepare('SELECT round,start_at FROM race_rooms WHERE code=?').bind(code).first();
  assert.equal(current.round,1);assert.equal(current.start_at,started.room.startAt);
  await gameAction(db,{action:'reset',code,hostToken:host.hostToken},started.room.settleAt+1);
  assert.ok((await roundResult(db,code,1,started.room.settleAt+1)).players[0].distance>0);
});

test('a heartbeat begun before cancellation replies with the latest readiness revision',async()=>{
  const db=database(),t=1000000,host:any=await gameAction(db,{action:'create'},t),code=host.room.code;
  const player:any=await gameAction(db,{action:'join',code,name:'延迟心跳'},t);
  await gameAction(db,{action:'ready',code,token:player.token,round:1,readyVersion:0,ready:true},t);
  let injected=false;
  const delayed={...db,prepare(query:string){
    const statement=db.prepare(query);
    if(!query.startsWith('UPDATE race_players SET updated_at=MAX'))return statement;
    return {bind(...args:any[]){statement.bind(...args);return this;},async run(){
      if(!injected){injected=true;await gameAction(db,{action:'ready',code,token:player.token,round:1,readyVersion:1,ready:false},t+2);}
      return statement.run();
    }};
  }} as unknown as D1Database;
  const reply:any=await gameAction(delayed,{action:'resume',code,token:player.token},t+1);
  assert.equal(reply.ready,false);assert.equal(reply.readyVersion,2);
});

test('archival retries a competing input write instead of saving unfinished distances',async()=>{
  const db=database(),t=1000000,host:any=await gameAction(db,{action:'create'},t),code=host.room.code;
  const player:any=await gameAction(db,{action:'join',code,name:'结算竞争'},t);
  await gameAction(db,{action:'ready',code,token:player.token,round:1,ready:true},t);
  const started:any=await gameAction(db,{action:'start',code,hostToken:host.hostToken},t);
  let injected=false;
  const competing={...db,async batch(statements:D1PreparedStatement[]){
    if(!injected){injected=true;await db.prepare('UPDATE race_players SET version=version+1 WHERE id=?').bind(player.player.id).run();}
    return db.batch(statements);
  }} as D1Database;
  const saved=await roundResult(competing,code,1,started.room.settleAt);
  const stored:any=await db.prepare('SELECT state FROM race_players WHERE id=?').bind(player.player.id).first();
  assert.equal(JSON.parse(stored.state).tick,3600);
  assert.equal(saved.players[0].distance,JSON.parse(stored.state).distance);
  const archives:any=await db.prepare('SELECT count(*) AS count FROM race_results WHERE room=?').bind(code).first();
  assert.equal(archives.count,1);
});

test('resume retries a restarted Worker with a finite limit; mutating requests never retry',async()=>{
  let calls=0;const pauses:number[]=[];
  const intermittent=(async()=>++calls<3?new Response('Your worker restarted mid-request.',{status:503}):Response.json({ready:false,readyVersion:2})) as typeof fetch;
  assert.deepEqual(await requestGame({action:'resume'},intermittent,async ms=>{pauses.push(ms);}),{ready:false,readyVersion:2});
  assert.equal(calls,3);assert.deepEqual(pauses,[200,400]);
  for(const action of ['resume','create','join','ready','start','reset','input','leave']){
    calls=0;
    const unavailable=(async()=>{calls++;return new Response('Worker restarted',{status:503});}) as typeof fetch;
    await assert.rejects(()=>requestGame({action},unavailable,async()=>{}),(e:any)=>e.status===503&&/连接暂时不可用/.test(e.message));
    assert.equal(calls,action==='resume'?3:1);
  }
});


test('visible obstacle edge and rotated drift corners collide, with clear gaps excluded',()=>{
  const obj=trackObject(0,47),s=initialState();
  Object.assign(s,{distance:obj.distance,x:obj.x+.4});
  assert.ok(objectContact(s,obj)); // Old centre-only .26 threshold missed this overlap.
  s.x=obj.x+.65;assert.equal(objectContact(s,obj),false);
  s.x=obj.x+.55;s.driftAngle=.8;assert.ok(objectContact(s,obj));
  for(const speed of [30,120,156]){
    s.viewZoom=speedZoom(speed);s.x=obj.x;s.driftAngle=0;
    s.distance=obj.distance-5;assert.ok(objectContact(s,obj));
    s.distance=obj.distance-20;assert.equal(objectContact(s,obj),false);
  }
});

test('front contact slows immediately before centre crossing and each obstacle hits once',()=>{
  const obj=trackObject(0,47),s=initialState();
  Object.assign(s,{base:120,speed:120,distance:obj.distance-7,x:obj.x,viewZoom:1.5});
  s.control.throttle=true;step(s,47);
  assert.ok(s.distance<obj.distance);assert.equal(s.hits,1);assert.equal(s.speed,60);
  assert.equal(s.hitUntil-s.tick,180);
  for(let i=0;i<120;i++)step(s,47);
  assert.equal(s.hits,1);
});


test('high-speed front contact cannot skip a barrier; a missed centre still allows rear-side contact',()=>{
  const obj=trackObject(0,47),fast=initialState();
  Object.assign(fast,{base:120,speed:156,nitroUntil:500,viewZoom:1.65,distance:obj.distance-8,x:obj.x});
  fast.control.throttle=true;step(fast,47);
  assert.equal(fast.hits,1);assert.equal(fast.speed,78);assert.equal(nitroMultiplier(fast),1.3);
  const side=initialState();Object.assign(side,{base:30,distance:obj.distance+1,x:obj.x-.8});
  step(side,47);assert.equal(side.hits,0);assert.equal(side.nextObject,0);
  side.x=obj.x;step(side,47);assert.equal(side.hits,1);assert.equal(side.nextObject,1);
});


test('the downloaded road texture asphalt boundary excludes both 20px curbs',()=>{
  assert.equal(TRACK_CONFIG.asphaltWidthRatio,88/128);
  const bounds=trackBounds(0),unit=TRACK_CONFIG.roadWidthRatio*.4/TRACK_CONFIG.halfWidth;
  assert.ok(bounds.max*unit+TRACK_CONFIG.carWidthRatio/2<TRACK_CONFIG.roadWidthRatio*44/128);
  assert.ok(bounds.min*unit-TRACK_CONFIG.carWidthRatio/2>-TRACK_CONFIG.roadWidthRatio*44/128);
});

test('curbs block the full car, slow on impact, and do not stack wall and obstacle penalties',()=>{
  for(const direction of [-1,1]){
    const s=initialState();s.base=120;s.control={throttle:true,drift:false,steer:direction};s.nextObject=10000;
    advance(s,180,[],47);
    assert.ok((s.wallHits??0)>=1);assert.ok(s.tick<(s.wallUntil??0));assert.equal(s.speed,60);assertBodyOnRoad(s);
    s.hitUntil=s.tick+180;assert.equal(actualSpeed(s),60);
    s.control.steer=-direction;const before=s.x;advance(s,s.tick+40,[],47);
    assert.ok((s.x-before)*direction<0);assertBodyOnRoad(s);
    s.control.steer=0;s.wallUntil=s.tick;s.hitUntil=s.tick;assert.equal(actualSpeed(s),120);
  }
});
