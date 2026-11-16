import {advance,COLORS,initialState,nitroMultiplier,RACE_TICKS,type InputEvent,type RaceState} from './race-sim.ts';
import {distanceScore,DISTANCE_SCORE_SQL,rankPlayers} from './race-ranking.ts';
type Room={code:string;host_hash:string;created_at:number;start_at:number|null;round:number;seed:number};
type Player={id:string;token_hash:string;room:string;name:string;color:string;state:string;distance:number;speed:number;round:number;version:number;updated_at:number;ready:number;ready_version:number;participating:number;membership:string};
type Result={room:string;round:number;seed:number;start_at:number;finished_at:number;participant_count:number;players:string};
export const ONLINE_WINDOW_MS=15000;
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
async function counts(db:D1Database,r:Room,now:number){
  const c=await db.prepare(`SELECT
    sum(CASE WHEN membership='active' THEN 1 ELSE 0 END) AS memberCount,
    sum(CASE WHEN membership='active' AND updated_at>? THEN 1 ELSE 0 END) AS onlineCount,
    sum(CASE WHEN membership='active' AND updated_at>? AND ready=1 THEN 1 ELSE 0 END) AS readyCount,
    sum(CASE WHEN participating=1 THEN 1 ELSE 0 END) AS participantCount
    FROM race_players WHERE room=? AND round=?`)
    .bind(now-ONLINE_WINDOW_MS,now-ONLINE_WINDOW_MS,r.code,r.round)
    .first<{memberCount:number;onlineCount:number;readyCount:number;participantCount:number}>();
  return {count:c?.onlineCount||0,onlineCount:c?.onlineCount||0,memberCount:c?.memberCount||0,
    readyCount:c?.readyCount||0,participantCount:c?.participantCount||0};
}
async function getPlayer(db:D1Database,r:Room,token:unknown){
  if(typeof token!=='string'||token.length>200)throw new GameError('参赛凭证无效，请重新加入。',401);
  const p=await db.prepare('SELECT * FROM race_players WHERE token_hash=? AND room=?').bind(await hash(token),r.code).first<Player>();
  if(!p)throw new GameError('没有找到你的赛车，请重新加入。',401);
  if(p.membership!=='active')throw new GameError(p.membership==='removed'?'主持人已将你移出房间。':'你已退出房间。',410);
  return p;
}
async function playerReply(db:D1Database,r:Room,p:Player,state:RaceState,now:number){
  // A ready/cancel request may have committed while this heartbeat was running.
  const latest=await db.prepare('SELECT ready,ready_version,round,membership FROM race_players WHERE id=?')
    .bind(p.id).first<Pick<Player,'ready'|'ready_version'|'round'|'membership'>>();
  if(!latest||latest.membership!=='active')throw new GameError('你已离开房间。',410);
  if(latest.round!==r.round)throw new GameError('比赛轮次已变化。',409);
  const score=distanceScore(state.distance);
  const standings=r.start_at!==null&&p.participating?await db.prepare(`SELECT
    sum(CASE WHEN ${DISTANCE_SCORE_SQL}>? THEN 1 ELSE 0 END) AS ahead,
    sum(CASE WHEN ${DISTANCE_SCORE_SQL}=? THEN 1 ELSE 0 END) AS tied
    FROM race_players WHERE room=? AND round=? AND participating=1`)
    .bind(score,score,r.code,r.round).first<{ahead:number;tied:number}>():null;
  return {player:{id:p.id,name:p.name,color:p.color},state,ready:!!latest.ready,readyVersion:latest.ready_version,participating:!!p.participating,
    rank:standings?(standings.ahead||0)+1:0,tied:(standings?.tied||0)>1,
    ...await counts(db,r,now),room:publicRoom(r,now)};
}
async function finalize(db:D1Database,r:Room,now:number){
  if(r.start_at===null||now<r.start_at+65000)return;
  const rows=await db.prepare('SELECT * FROM race_players WHERE room=? AND round=? AND participating=1').bind(r.code,r.round).all<Player>();
  const updates=[];
  for(const p of rows.results){
    const s:RaceState=JSON.parse(p.state);if(s.tick>=RACE_TICKS)continue;
    advance(s,RACE_TICKS,[{tick:Math.min(RACE_TICKS,s.tick+60),throttle:false,drift:false,steer:0}],r.seed);
    updates.push(db.prepare('UPDATE race_players SET state=?,distance=?,speed=?,version=version+1 WHERE id=? AND version=? AND round=?')
      .bind(JSON.stringify(s),s.distance,s.speed,p.id,p.version,r.round));
  }
  if(updates.length)await db.batch(updates);
}
async function archiveFinishedRound(db:D1Database,r:Room,now:number){
  if(r.start_at===null||now<r.start_at+65000)return;
  if(await db.prepare('SELECT round FROM race_results WHERE room=? AND round=?').bind(r.code,r.round).first())return;
  // Retry optimistic finalization if an already-running input request won a write.
  for(let retry=0;retry<3;retry++){
    await finalize(db,r,now);
    const rows=await db.prepare('SELECT id,name,color,state,distance FROM race_players WHERE room=? AND round=? AND participating=1 ORDER BY distance DESC,id ASC')
      .bind(r.code,r.round).all<Pick<Player,'id'|'name'|'color'|'state'|'distance'>>();
    if(rows.results.some(p=>JSON.parse(p.state).tick<RACE_TICKS))continue;
    const players=rankPlayers(rows.results.map(({state,...p})=>({...p,speed:0,connected:false,ready:false,participating:true,nitro:false})));
    await db.prepare(`INSERT OR IGNORE INTO race_results(room,round,seed,start_at,finished_at,participant_count,players)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM race_rooms WHERE code=? AND round=?)
      AND NOT EXISTS(SELECT 1 FROM race_players WHERE room=? AND round=? AND participating=1 AND json_extract(state,'$.tick')<?)`)
      .bind(r.code,r.round,r.seed,r.start_at,r.start_at+65000,players.length,JSON.stringify(players),r.code,r.round,r.code,r.round,RACE_TICKS).run();
    if(await db.prepare('SELECT round FROM race_results WHERE room=? AND round=?').bind(r.code,r.round).first())return;
  }
  throw new GameError('成绩仍在确认，请稍后重试。',409);
}
async function history(db:D1Database,code:string){
  const rows=await db.prepare('SELECT round,finished_at AS finishedAt,participant_count AS count FROM race_results WHERE room=? ORDER BY round DESC')
    .bind(code).all<{round:number;finishedAt:number;count:number}>();
  return rows.results;
}
export async function roundResult(db:D1Database,code:string,round:number,now=Date.now()){
  const room=await getRoom(db,code);
  if(!Number.isSafeInteger(round)||round<1)throw new GameError('比赛局数不正确。');
  if(round===room.round)await archiveFinishedRound(db,room,now);
  const saved=await db.prepare('SELECT * FROM race_results WHERE room=? AND round=?').bind(room.code,round).first<Result>();
  if(!saved)throw new GameError('这一局尚未结算，或没有已保存的成绩。',404);
  const players=JSON.parse(saved.players);
  return {room:{code:room.code,round:saved.round,seed:saved.seed,startAt:saved.start_at,endAt:saved.start_at+60000,
    settleAt:saved.finished_at,serverNow:now,phase:'finished'},players,count:saved.participant_count,participantCount:saved.participant_count};
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
  if(b.action==='remove'){
    await authorize(room,b.hostToken);
    if(room.start_at!==null)throw new GameError('请在下一局准备时移除车手，比赛成绩会保留。',409);
    const changed=await db.prepare(`UPDATE race_players SET membership='removed',ready=0,ready_version=ready_version+1
      WHERE id=? AND room=? AND membership='active'
      AND EXISTS(SELECT 1 FROM race_rooms WHERE code=? AND start_at IS NULL AND round=?)`)
      .bind(String(b.playerId||''),room.code,room.code,room.round).run();
    if(!changed.meta.changes)throw new GameError('车手已离开，或房间状态已变化。',409);
    return {...await counts(db,room,now),room:publicRoom(room,now)};
  }
  if(b.action==='start'||b.action==='reset'){
    await authorize(room,b.hostToken);
    if(b.action==='start'){
      if(room.start_at!==null)throw new GameError('这一局已经开始。');
      const current=await counts(db,room,now);
      if(!current.onlineCount)throw new GameError('至少一位在线车手准备后才能发车。');
      if(current.readyCount!==current.onlineCount)throw new GameError('还有在线车手未准备，请等候或移除后再发车。',409);
      const startAt=now+5000,cutoff=now-ONLINE_WINDOW_MS;
      const changed=await db.batch([
        db.prepare(`UPDATE race_rooms SET start_at=? WHERE code=? AND round=? AND start_at IS NULL
          AND EXISTS(SELECT 1 FROM race_players WHERE room=? AND round=? AND membership='active' AND updated_at>? AND ready=1)
          AND NOT EXISTS(SELECT 1 FROM race_players WHERE room=? AND round=? AND membership='active' AND updated_at>? AND ready=0)`)
          .bind(startAt,room.code,room.round,room.code,room.round,cutoff,room.code,room.round,cutoff),
        db.prepare(`UPDATE race_players SET participating=CASE WHEN membership='active' AND updated_at>? AND ready=1 THEN 1 ELSE 0 END
          WHERE room=? AND round=? AND EXISTS(SELECT 1 FROM race_rooms WHERE code=? AND round=? AND start_at=?)`)
          .bind(cutoff,room.code,room.round,room.code,room.round,startAt),
      ]);
      if(!changed[0].meta.changes)throw new GameError('准备状态已变化，请检查后再发车。',409);
    }else{
      if(room.start_at!==null&&now<room.start_at+65000)throw new GameError('本局结算后才能再来一局。');
      await archiveFinishedRound(db,room,now);
      const next=room.round+1,seed=crypto.getRandomValues(new Uint32Array(1))[0];
      const changed=await db.batch([
        db.prepare(`UPDATE race_rooms SET start_at=NULL,round=?,seed=? WHERE code=? AND round=?
          AND (start_at IS NULL OR EXISTS(SELECT 1 FROM race_results WHERE room=? AND round=?))`)
          .bind(next,seed,room.code,room.round,room.code,room.round),
        db.prepare(`UPDATE race_players SET state=?,distance=0,speed=0,ready=0,ready_version=ready_version+1,participating=0,round=?,version=version+1
          WHERE room=? AND round<? AND EXISTS(SELECT 1 FROM race_rooms WHERE code=? AND round=? AND start_at IS NULL)`)
          .bind(JSON.stringify(initialState()),next,room.code,next,room.code,next),
      ]);
      if(!changed[0].meta.changes)throw new GameError('房间已重置，请刷新。',409);
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
      SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM race_players WHERE room=? AND membership='active')<100
      AND EXISTS(SELECT 1 FROM race_rooms WHERE code=? AND round=? AND start_at IS NULL)`)
      .bind(id,await hash(token),room.code,name,color,JSON.stringify(initialState()),room.round,now,room.code,room.code,room.round).run();
    if(!result.meta.changes)throw new GameError('房间已满或比赛已经开始。',409);
    return {token,player:{id,name,color},state:initialState(),ready:false,readyVersion:0,participating:false,rank:0,tied:false,
      ...await counts(db,room,now),room:publicRoom(room,now)};
  }
  if(b.action==='resume'||b.action==='input'||b.action==='ready'||b.action==='leave'){
    const p=await getPlayer(db,room,b.token);
    if(p.round!==room.round)throw new GameError('正在准备下一局，请稍后重试。',409);
    if(b.action==='leave'){
      await db.prepare("UPDATE race_players SET membership='left',ready=0,ready_version=ready_version+1 WHERE id=?").bind(p.id).run();
      return {left:true,...await counts(db,room,now),room:publicRoom(room,now)};
    }
    if(b.action==='ready'){
      if(typeof b.ready!=='boolean')throw new GameError('准备状态格式不正确。');
      if(room.start_at!==null||Number(b.round)!==room.round)throw new GameError('比赛状态已变化，请等待下一局。',409);
      if(b.readyVersion!==undefined&&b.readyVersion!==p.ready_version)throw new GameError('准备状态已更新，请再点一次。',409);
      const changed=await db.prepare(`UPDATE race_players SET ready=?,ready_version=ready_version+1,updated_at=MAX(updated_at,?) WHERE id=? AND membership='active' AND round=? AND ready_version=?
        AND EXISTS(SELECT 1 FROM race_rooms WHERE code=? AND round=? AND start_at IS NULL)`)
        .bind(b.ready?1:0,now,p.id,room.round,p.ready_version,room.code,room.round).run();
      if(!changed.meta.changes)throw new GameError('比赛状态已变化，请刷新。',409);
      p.ready=b.ready?1:0;
      return playerReply(db,room,p,JSON.parse(p.state),now);
    }
    await db.prepare(`UPDATE race_players SET updated_at=MAX(updated_at,?),
      ready_version=ready_version+CASE WHEN ?=1 AND updated_at<=? AND ready=1 THEN 1 ELSE 0 END,
      ready=CASE WHEN ?=1 AND updated_at<=? THEN 0 ELSE ready END
      WHERE id=? AND membership='active' AND round=?`)
      .bind(now,room.start_at===null?1:0,now-ONLINE_WINDOW_MS,room.start_at===null?1:0,now-ONLINE_WINDOW_MS,p.id,room.round).run();
    if(b.action==='input'&&Number(b.round)!==room.round)throw new GameError('比赛轮次已变化。',409);
    let state:RaceState=JSON.parse(p.state);
    if(b.action==='input'&&p.participating&&room.start_at!==null&&now<room.start_at+65000){
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
      await archiveFinishedRound(db,room,now);
      const latest=await db.prepare('SELECT state FROM race_players WHERE id=?').bind(p.id).first<{state:string}>();
      if(latest)state=JSON.parse(latest.state);
    }
    return playerReply(db,room,p,state,now);
  }
  throw new GameError('不支持的操作。');
}
export async function roomSnapshot(db:D1Database,code:string,now=Date.now()){
  const room=await getRoom(db,code);await archiveFinishedRound(db,room,now);
  const rows=await db.prepare(`SELECT id,name,color,distance,speed,state,updated_at,ready,participating,membership FROM race_players
    WHERE room=? AND round=? AND ${room.start_at===null?"membership='active'":'participating=1'}
    ORDER BY distance DESC,id ASC LIMIT 100`).bind(room.code,room.round)
    .all<Pick<Player,'id'|'name'|'color'|'distance'|'speed'|'state'|'updated_at'|'ready'|'participating'|'membership'>>();
  const players=rankPlayers(rows.results.map(({state,ready,participating,...p})=>{
    const connected=p.membership==='active'&&now-p.updated_at<ONLINE_WINDOW_MS;
    return {...p,ready:!!ready&&connected,participating:!!participating,connected,nitro:nitroMultiplier(JSON.parse(state))>1};
  }));
  return {room:publicRoom(room,now),players,...await counts(db,room,now),history:await history(db,room.code)};
}
