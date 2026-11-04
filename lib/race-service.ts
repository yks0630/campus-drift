import {advance,COLORS,initialState,RACE_TICKS,type InputEvent,type RaceState} from './race-sim.ts';
type Room={code:string;host_hash:string;created_at:number;start_at:number|null;round:number;seed:number};
type Player={id:string;token_hash:string;room:string;name:string;color:string;state:string;distance:number;speed:number;round:number;version:number;updated_at:number};
export class GameError extends Error {
  status:number;
  constructor(message:string,status=400){super(message);this.status=status;}
}
const secret=()=>crypto.randomUUID()+crypto.randomUUID();
async function hash(value:string){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
async function getRoom(db:D1Database,code:unknown){
  const room=await db.prepare('SELECT * FROM race_rooms WHERE code=?').bind(String(code||'').replace(/\D/g,'').slice(0,6)).first<Room>();
  if(!room)throw new GameError('没有找到这个房间，请检查六位房间号。',404);
  return room;
}
function publicRoom(r:Room,now:number){
  const endAt=r.start_at===null?null:r.start_at+60000;
  return {code:r.code,round:r.round,seed:r.seed,startAt:r.start_at,endAt,
    settleAt:endAt===null?null:endAt+5000,serverNow:now,
    phase:r.start_at===null?'waiting':now<r.start_at?'countdown':now<endAt!?'racing':now<endAt!+5000?'settling':'finished'};
}
async function authorize(r:Room,token:unknown){
  if(typeof token!=='string'||await hash(token)!==r.host_hash)
    throw new GameError('请使用创建房间的设备进行主持操作。',403);
}
async function finalize(db:D1Database,r:Room,now:number){
  if(r.start_at===null||now<r.start_at+65000)return;
  const rows=await db.prepare('SELECT * FROM race_players WHERE room=? AND round=?').bind(r.code,r.round).all<Player>();
  const updates=[];
  for(const p of rows.results){
    const s:RaceState=JSON.parse(p.state);if(s.tick>=RACE_TICKS)continue;
    advance(s,RACE_TICKS,[{tick:Math.min(RACE_TICKS,s.tick+60),throttle:false,drift:false,steer:0}],r.seed);
    updates.push(db.prepare('UPDATE race_players SET state=?,distance=?,speed=?,version=version+1 WHERE id=? AND version=? AND round=?')
      .bind(JSON.stringify(s),s.distance,s.speed,p.id,p.version,r.round));
  }
  if(updates.length)await db.batch(updates);
}
export async function gameAction(db:D1Database,b:Record<string,unknown>,now=Date.now()){
  if(b.action==='create'){
    const hostToken=secret(),hostHash=await hash(hostToken);
    for(let retry=0;retry<5;retry++){
      const random=crypto.getRandomValues(new Uint32Array(2)),code=String(100000+random[0]%900000);
      try{
        await db.prepare('INSERT INTO race_rooms(code,host_hash,created_at,seed) VALUES(?,?,?,?)').bind(code,hostHash,now,random[1]).run();
        return {room:publicRoom(await getRoom(db,code),now),hostToken};
      }catch(e){if(!String(e).includes('UNIQUE'))throw e;}
    }
    throw new GameError('创建房间失败，请重试。',503);
  }
  const room=await getRoom(db,b.code);
  if(b.action==='start'||b.action==='reset'){
    await authorize(room,b.hostToken);
    if(b.action==='start'){
      if(room.start_at!==null)throw new GameError('这一局已经开始。');
      const count=await db.prepare('SELECT count(*) AS n,sum(CASE WHEN round!=? THEN 1 ELSE 0 END) AS pending FROM race_players WHERE room=?').bind(room.round,room.code).first<{n:number;pending:number}>();
      if(!count?.n)throw new GameError('至少一位玩家加入后才能发车。');
      if(count.pending)throw new GameError('正在准备下一局，请稍后再发车。',409);
      const changed=await db.prepare('UPDATE race_rooms SET start_at=? WHERE code=? AND round=? AND start_at IS NULL').bind(now+5000,room.code,room.round).run();
      if(!changed.meta.changes)throw new GameError('发车状态已更新，请刷新。',409);
    }else{
      if(room.start_at!==null&&now<room.start_at+65000)throw new GameError('本局结算后才能再来一局。');
      const next=room.round+1,seed=crypto.getRandomValues(new Uint32Array(1))[0];
      const changed=await db.prepare('UPDATE race_rooms SET start_at=NULL,round=?,seed=? WHERE code=? AND round=?').bind(next,seed,room.code,room.round).run();
      if(!changed.meta.changes)throw new GameError('房间已重置，请刷新。',409);
      await db.prepare('UPDATE race_players SET state=?,distance=0,speed=0,round=?,version=version+1 WHERE room=? AND round<?')
        .bind(JSON.stringify(initialState()),next,room.code,next).run();
    }
    return {room:publicRoom(await getRoom(db,room.code),now)};
  }
  if(b.action==='join'){
    if(room.start_at!==null)throw new GameError('本局已发车，下一局再加入吧。');
    const name=String(b.name||'').trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,12);
    if(!name)throw new GameError('请输入你的昵称。');
    const color=COLORS.includes(b.color as typeof COLORS[number])?String(b.color):'blue';
    const token=secret(),id=crypto.randomUUID();
    const result=await db.prepare(`INSERT INTO race_players(id,token_hash,room,name,color,state,round,updated_at)
      SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM race_players WHERE room=?)<100
      AND EXISTS(SELECT 1 FROM race_rooms WHERE code=? AND round=? AND start_at IS NULL)`)
      .bind(id,await hash(token),room.code,name,color,JSON.stringify(initialState()),room.round,now,room.code,room.code,room.round).run();
    if(!result.meta.changes)throw new GameError('房间已满或比赛已经开始。',409);
    return {token,player:{id,name,color},state:initialState(),room:publicRoom(room,now)};
  }
  if(b.action==='resume'||b.action==='input'){
    if(typeof b.token!=='string'||b.token.length>200)throw new GameError('参赛凭证无效，请重新加入。',401);
    const p=await db.prepare('SELECT * FROM race_players WHERE token_hash=? AND room=?').bind(await hash(b.token),room.code).first<Player>();
    if(!p)throw new GameError('没有找到你的赛车，请重新加入。',401);
    if(p.round!==room.round)throw new GameError('正在准备下一局，请稍后重试。',409);
    if(b.action==='input'&&Number(b.round)!==room.round)throw new GameError('比赛轮次已变化。',409);
    let state:RaceState=JSON.parse(p.state);
    if(b.action==='input'&&room.start_at!==null&&now<room.start_at+65000){
      const limit=Math.max(0,Math.min(RACE_TICKS,Math.floor((now-room.start_at)*.06))),until=Number(b.until);
      if(!Number.isSafeInteger(until)||until<0||until>limit+2)throw new GameError('比赛时钟正在校准，请重试。',409);
      const raw=b.events;
      if(!Array.isArray(raw)||raw.length>1500)throw new GameError('操作数据格式不正确。');
      const events:InputEvent[]=[];let previous=-1;
      for(const v of raw){
        if(!v||!Number.isSafeInteger(v.tick)||v.tick<previous||v.tick<0||v.tick>RACE_TICKS
          ||typeof v.throttle!=='boolean'||typeof v.drift!=='boolean'||!Number.isFinite(v.steer)||Math.abs(v.steer)>1)
          throw new GameError('操作数据格式不正确。');
        previous=v.tick;if(v.tick>=state.tick&&v.tick<=until)events.push(v);
      }
      if(until>state.tick){
        advance(state,Math.min(until,limit),events,room.seed);
        const updated=await db.prepare('UPDATE race_players SET state=?,distance=?,speed=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND round=?')
          .bind(JSON.stringify(state),state.distance,state.speed,now,p.id,p.version,room.round).run();
        if(!updated.meta.changes)throw new GameError('操作正在同步，请重试。',409);
      }
    }
    if(now>=(room.start_at??Infinity)+65000){
      await finalize(db,room,now);
      const latest=await db.prepare('SELECT state FROM race_players WHERE id=?').bind(p.id).first<{state:string}>();
      if(latest)state=JSON.parse(latest.state);
    }
    const ahead=await db.prepare('SELECT count(*) AS n FROM race_players WHERE room=? AND round=? AND (distance>? OR (distance=? AND id<?))')
      .bind(room.code,room.round,state.distance,state.distance,p.id).first<{n:number}>();
    return {player:{id:p.id,name:p.name,color:p.color},state,rank:(ahead?.n||0)+1,room:publicRoom(room,now)};
  }
  throw new GameError('不支持的操作。');
}
export async function roomSnapshot(db:D1Database,code:string,now=Date.now()){
  const room=await getRoom(db,code);await finalize(db,room,now);
  const rows=await db.prepare('SELECT id,name,color,distance,speed,updated_at FROM race_players WHERE room=? AND round=? ORDER BY distance DESC,id ASC LIMIT 100')
    .bind(room.code,room.round).all<{id:string;name:string;color:string;distance:number;speed:number;updated_at:number}>();
  return {room:publicRoom(room,now),players:rows.results.map((p,i)=>({...p,rank:i+1,connected:now-p.updated_at<5000})),count:rows.results.length};
}
