'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type PointerEvent as ReactPointerEvent} from 'react';
import QRCode from 'qrcode';
import RaceCanvas from './RaceCanvas';
import {RaceSteering} from '@/lib/race-steering';
import {formatDistance,resultsCsv} from '@/lib/race-ranking';
import {acceptReadiness,releasedControl,restoredControl,sampleControl,requestGame} from '@/lib/race-client';
import {advance,clamp,COLORS,initialState,nitroMultiplier,RACE_TICKS,step,trackObject,type Control,type InputEvent,type RaceState} from '@/lib/race-sim';

type Room={code:string;round:number;seed:number;startAt:number|null;endAt:number|null;settleAt:number|null;serverNow:number;phase:string};
type Player={id:string;name:string;color:string;distance:number;speed:number;rank:number;connected:boolean;nitro?:boolean;ready?:boolean;participating?:boolean;tied?:boolean;membership?:string};
type HistoryRound={round:number;finishedAt:number;count:number};
export type Snapshot={room:Room;players:Player[];count:number;onlineCount?:number;memberCount?:number;readyCount?:number;participantCount?:number;history?:HistoryRound[]};
export type DriverReview={phase:'waiting'|'racing'|'finished';now:number;ready?:boolean;calibrated?:boolean};
type Session={token:string;player:Pick<Player,'id'|'name'|'color'>};
const ASSET='/assets/racing/';
const colorNames:Record<string,string>={blue:'海盐蓝',red:'烈焰红',green:'薄荷绿',yellow:'闪电黄',black:'曜石黑'};
const jsonStore={get:(key:string)=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}},set:(key:string,value:unknown)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}},remove:(key:string)=>{try{localStorage.removeItem(key);}catch{}}};
const api=requestGame;
function car(color:string,className=''){return <img className={className} src={ASSET+'car_'+color+'_1.png'} alt={colorNames[color]+'赛车'}/>;}
function downloadResults(code:string,round:number,players:Player[]){
  const url=URL.createObjectURL(new Blob([resultsCsv(players)],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='极速热场-'+code+'-第'+round+'局.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Brand(){return <a className="brand" href="/"><span>极速热场</span></a>;}
function Credits(){return <footer className="artist-credit">UI assets by <a href="https://www.villeseppanen.com" target="_blank" rel="noreferrer">Ville Seppänen</a> · <a href="/assets/ville/ATTRIBUTION.txt">CC BY 4.0</a><br/>氮气图标：<a href="https://www.flaticon.com/free-icon/nitrous-oxide_16108780" title="Nitrous oxide icons created by Vector Squad - Flaticon">Vector Squad / Flaticon</a></footer>;}
function Tag({children}:{children:React.ReactNode}){return <span className="tag"><i/>{children}</span>;}
function HoldButton({label,hint,color,onHold,kind='round'}:{label:string;hint:string;color:string;onHold:(held:boolean)=>void;kind?:string}){
  const[held,setHeld]=useState(false);
  const release=()=>{setHeld(false);onHold(false);};
  return <button className={'drive-button '+(held?'held':'')} style={{backgroundImage:`url(/assets/ville/${color==='yellow'?'20-00':'20-01'}.png)`}}
    aria-label={label} aria-pressed={held} onContextMenu={e=>e.preventDefault()}
    onPointerDown={(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setHeld(true);onHold(true);}}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
    <strong>{label}</strong><small>{hint}</small></button>;
}
function useSnapshot(code:string,review?:Snapshot,archivedRound?:number){
  const[data,setData]=useState<Snapshot|null>(review||null),[error,setError]=useState(''),[connected,setConnected]=useState(true);
  useEffect(()=>{if(review)return;let alive=true,busy=false,complete=false,controller:AbortController|null=null;
    async function load(){if(busy||complete)return;busy=true;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),6000);
      try{const response=await fetch('/api/game?code='+code+(archivedRound===undefined?'':'&round='+archivedRound),{cache:'no-store',signal:controller.signal});const json:any=await response.json();
        if(!response.ok)throw new Error(json.error);if(alive){setData(json);setError('');setConnected(true);complete=archivedRound!==undefined;}}
      catch(e){if(alive){setConnected(false);setError(e instanceof Error?e.message:'正在重新连接');}}
      finally{clearTimeout(timeout);busy=false;}}
    load();const timer=setInterval(load,900);return()=>{alive=false;clearInterval(timer);controller?.abort();};
  },[code,review,archivedRound]);return {data,error,connected};
}
function JoinForm({initialCode='',onJoin}:{initialCode?:string;onJoin:(code:string,session:Session,data:any)=>void}){
  const[code,setCode]=useState(initialCode),[name,setName]=useState(''),[color,setColor]=useState('blue'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setName(jsonStore.get('race-name')||'');},[]);
  async function join(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');
    try{const data=await api({action:'join',code,name,color});const session={token:data.token,player:data.player};jsonStore.set('race-player-'+code,session);jsonStore.set('race-name',name);onJoin(code,session,data);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <form className="join-form" onSubmit={join}>
    <div className="form-heading"><span className="eyebrow">加入比赛</span><h2>选择你的赛车</h2><p>输入房间号和昵称。</p></div>
    <label>房间号<input aria-label="房间号" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="off" placeholder="输入 6 位房间号" pattern="[0-9]{6}" required maxLength={6}/></label>
    <label>车手昵称<input aria-label="车手昵称" value={name} onChange={e=>setName(e.target.value)} placeholder="输入昵称" maxLength={12} required autoComplete="nickname"/></label>
    <fieldset><legend>选一辆你的赛车</legend><div className="car-picker">{COLORS.map(c=><button type="button" key={c} title={colorNames[c]} aria-label={colorNames[c]} aria-pressed={color===c} className={color===c?'selected':''} onClick={()=>setColor(c)}>{car(c)}</button>)}</div></fieldset>
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="primary wide" disabled={busy}>{busy?'正在驶入发车区…':'加入比赛 →'}</button>
    <p className="form-note">无需下载 · 手机竖屏 · 每局 60 秒</p>
  </form>;
}
function Landing({onJoin}:{onJoin:(code:string,s:Session,d:any)=>void}){
  return <main className="landing"><div className="menu-emblem"><img src="/assets/ville/victory.png" alt="赛车奖杯与方格旗"/><h1>极速热场</h1></div><section className="menu-panel"><h2>60 秒赛车挑战</h2><p>竖屏操作 · 按距离排名</p><a className="primary wide" href="/?mode=join">加入比赛</a><a className="secondary wide" href="/?practice=1">单人试驾</a><div className="menu-pair"><a className="secondary" href="/?mode=host">主持台</a><a className="secondary" href="/?mode=screen">大屏排名</a></div><details><summary>操作说明</summary><p>选择体感驾驶后倾斜手机转向，或选择按键驾驶使用 ← → 转向。左下漂移，右下加速。松手巡航 30 码，按住加速最高 120 码；氮气提速 30%，障碍减速 50%。一局 60 秒。</p></details></section><Credits/></main>;
}
function JoinScreen({code='',onJoin}:{code?:string;onJoin:(code:string,s:Session,d:any)=>void}){
  return <div className="mobile-join"><Brand/><div className="join-card"><JoinForm initialCode={code} onJoin={onJoin}/></div><a className="secondary" href="/?practice=1">单人试驾</a><Credits/></div>;
}
function RoomPicker({mode}:{mode:string}){
  const[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function create(){setBusy(true);setError('');try{const d=await api({action:'create'});jsonStore.set('race-host-'+d.room.code,d.hostToken);location.href='/?host='+d.room.code;}catch(e){setError((e as Error).message);setBusy(false);}}
  return <div className="utility-page"><header><Brand/><a href="/">返回首页</a></header><div className="utility-card"><span className="eyebrow">{mode==='host'?'RACE CONTROL':'LIVE LEADERBOARD'}</span><h1>{mode==='host'?'创建比赛':'大屏排名'}</h1><p>{mode==='host'?'创建房间，投屏二维码，学生扫码后统一开始。':'输入房间号，打开横屏实时排名。'}</p>
    {mode==='host'?<button className="primary wide" onClick={create} disabled={busy}>{busy?'正在创建房间…':'创建比赛房间 →'}</button>:<form onSubmit={e=>{e.preventDefault();location.href='/?screen='+code;}}><label>房间号<input aria-label="房间号" inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} maxLength={6} required placeholder="输入六位房间号"/></label><button className="primary wide">打开实时大屏 →</button></form>}
    {error&&<p className="error" role="alert">{error}</p>}<div className="utility-art">{['yellow','red','blue','green'].map(c=>car(c))}</div></div><Credits/></div>;
}
function Qr({url}:{url:string}){
  const[src,setSrc]=useState('');useEffect(()=>{let active=true;QRCode.toDataURL(url,{width:280,margin:2,color:{dark:'#111d2d',light:'#ffffff'}}).then(s=>{if(active)setSrc(s);});return()=>{active=false;};},[url]);
  return src?<img className="qr" src={src} alt="扫码加入此房间"/>:<div className="qr-placeholder">正在生成二维码…</div>;
}
function Scoreboard({players,limit=10,waiting=false,onRemove,busy=false}:{players:Player[];limit?:number;waiting?:boolean;onRemove?:(id:string)=>void;busy?:boolean}){
  return <div className={'scoreboard '+(waiting?'lobby-members':'')}><div className="score-heading"><span>{waiting?'车手':'名次 / 车手'}</span><span>{waiting?'准备状态':'前进距离'}</span></div>{players.slice(0,limit).map(p=><div className={'score-row place-'+(waiting?0:p.rank)} key={p.id}>
    {!waiting&&<b>{String(p.rank).padStart(2,'0')}{p.tied&&<small>并列</small>}</b>}{car(p.color)}<span className="player-name">{p.name}</span>
    {waiting?<><span className={'member-state '+(!p.connected?'offline':p.ready?'online':'')}>{!p.connected?'离线':p.ready?'已准备':'未准备'}</span>{onRemove&&<button className="secondary remove-member" disabled={busy} onClick={()=>onRemove(p.id)} aria-label={'移除'+p.name}>移除</button>}</>:<strong>{formatDistance(p.distance)}<small> m</small></strong>}
    </div>)}{!players.length&&<div className="empty-rank">等待玩家加入<span>扫描房间二维码即可参赛。</span></div>}</div>;
}
function ArchivedScores({code,round}:{code:string;round:number}){
  const{data,error}=useSnapshot(code,undefined,round);
  return <section className="archived-scores"><h3>第 {round} 局成绩</h3>{data?<><Scoreboard players={data.players} limit={data.players.length}/><p className="rank-note">本局共 {data.participantCount} 人，已保存。</p><button className="secondary wide" onClick={()=>downloadResults(code,round,data.players)}>导出第 {round} 局成绩 ↓</button></>:<p role="status">{error||'正在读取成绩…'}</p>}</section>;
}
function HistoryPanel({code,rounds}:{code:string;rounds:HistoryRound[]}){
  const[selected,setSelected]=useState('');
  if(!rounds.length)return null;
  return <div className="history-panel"><label>历局成绩<select aria-label="历局成绩" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择已结束的比赛</option>{rounds.map(r=><option key={r.round} value={r.round}>第 {r.round} 局 · {r.count} 人</option>)}</select></label>{selected&&<ArchivedScores key={selected} code={code} round={Number(selected)}/>}</div>;
}
function DriverScores({code,onClose}:{code:string;onClose:()=>void}){
  const{data,error}=useSnapshot(code);
  return <div className="game-overlay driver-scores" role="dialog" aria-label="全场成绩"><h2>全场成绩</h2>{data?<><p>第 {data.room.round} 局 · {data.room.phase==='finished'?'最终成绩':'实时排位'}</p><Scoreboard players={data.players} limit={data.players.length}/></>:<p role="status">{error||'正在读取成绩…'}</p>}<button className="secondary" onClick={onClose}>返回我的赛车</button></div>;
}
export function RoomView({code,host=false,review}:{code:string;host?:boolean;review?:Snapshot}){
  const{data,error,connected}=useSnapshot(code,review),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[origin,setOrigin]=useState(''),[now,setNow]=useState(Date.now());
  useEffect(()=>{setOrigin(location.origin);const t=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(t);},[]);
  const room=data?.room,clockOffset=useRef(0);
  useEffect(()=>{if(data)clockOffset.current=data.room.serverNow-Date.now();},[data]);
  const clock=review?.room.serverNow??now+clockOffset.current;
  async function action(name:string,extra:Record<string,unknown>={}){setBusy(true);setMessage('');try{await api({action:name,code,hostToken:jsonStore.get('race-host-'+code),...extra});}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  const phase=room?.phase||'waiting',end=room?.endAt||0;
  let timer='60';if(phase==='countdown')timer=String(Math.max(1,Math.ceil(((room?.startAt||0)-clock)/1000)));else if(phase==='racing')timer=String(Math.max(0,Math.ceil((end-clock)/1000)));
  const phaseText:Record<string,string>={waiting:'等待车手集结',countdown:'准备发车',racing:'比赛进行中',settling:'成绩确认中',finished:'本场比赛结束'};
  const all=data?.players||[];
  const onlineCount=data?.onlineCount??data?.count??0,memberCount=data?.memberCount??all.length,readyCount=data?.readyCount??all.filter(p=>p.ready&&p.connected).length;
  const participantCount=data?.participantCount??all.length,canStart=onlineCount>0&&readyCount===onlineCount;
  return <div className={'race-screen '+(host?'host-screen':'')}><header><Brand/><Tag>{connected?'实时连接':'正在重连'}</Tag><div className="room-label">房间号 <b>{code}</b></div><button className="ghost" onClick={()=>document.documentElement.requestFullscreen?.().catch(()=>{})}>全屏 ↗</button></header>
    {!data&&error?<div className="screen-error"><h2>{error}</h2><a href="/">返回首页</a></div>:<main className="screen-grid"><section className="live-stage"><div className="stage-top"><div><span className="eyebrow">{phase==='finished'?'FINAL RESULTS':'CAMPUS GRAND PRIX / LIVE'}</span><h1>{phase==='finished'?'本场成绩':phase==='waiting'?'等待玩家入场':'比赛进行中'}</h1></div><div className={'race-clock '+(phase==='racing'&&Number(timer)<=10?'urgent':'')}><span>{phaseText[phase]}</span><strong>{phase==='finished'?'FIN':phase==='settling'?'…':timer}</strong><small>{phase==='racing'?'SECONDS LEFT':'60 秒 · 距离排位赛'}</small></div></div>
    {phase==='waiting'?<div className="waiting-stage"><div className="waiting-qr">{origin&&<Qr url={origin+'/?room='+code}/>}<strong>扫码入场，竖屏开跑</strong><span>房间号 {code} · 无需下载</span></div><div className="waiting-cars">{COLORS.slice(0,4).map((c,i)=><div key={c} style={{transform:`translateY(${i%2*34}px)`}}>{car(c)}<span>{colorNames[c]}</span></div>)}</div></div>
      :phase==='finished'?<div className="podium"><img className="podium-trophy" src="/assets/ville/victory.png" alt="奖杯与方格旗"/>{[2,1,3].map(place=>{const group=all.filter(p=>p.rank===place),p=group[0];return <div key={place} className={'podium-place position-'+place}>{p?<>{car(p.color)}<h2 title={group.map(v=>v.name).join('、')}>{group.slice(0,2).map(v=>v.name).join('、')}{group.length>2?'等'+group.length+'人':''}</h2><p>{formatDistance(p.distance)} m</p><strong>{group.length>1?'并列':''}{place===1?'冠军':place===2?'亚军':'季军'} <b>{place}</b></strong></>:<span>—</span>}</div>;})}</div>
      :<div className="race-lanes">{all.slice(0,6).map((p,i)=><div className="race-lane" key={p.id}><span>{p.rank}<b>{p.name}</b></span><div className="lane-road" style={{backgroundImage:`url(${ASSET}road_asphalt01.png)`}}><div className="lane-car" style={{left:`${8+p.distance/Math.max(100,...all.map(v=>v.distance))*77}%`}}>{p.nitro&&phase==='racing'&&<img className="lane-boost" src="/assets/gameplay/fire11.png" alt="氮气喷焰"/>}{car(p.color)}<small>{Math.round(p.speed)} 码</small></div></div><strong>{p.distance.toFixed(0)} m</strong></div>)}{phase==='countdown'&&<div className="screen-countdown">{timer}<small>准备发车</small></div>}{phase==='settling'&&<div className="settling-banner">比赛已结束，正在等待最后的成绩同步…</div>}</div>}
    <div className="stage-footer"><span><i/>房间人数：{onlineCount} 人在线</span><span>{phase==='waiting'?'已准备 '+readyCount+' 人 · 离线 '+(memberCount-onlineCount)+' 人':'本局参赛 '+participantCount+' 人'}</span><b>60 秒距离赛</b></div>
    {host&&<div className="host-actions"><a className="secondary" href={'/?room='+code} target="_blank" rel="noreferrer">用这台设备参赛 ↗</a><a className="secondary" href={'/?screen='+code} target="_blank" rel="noreferrer">打开纯大屏 ↗</a><button className="secondary" onClick={()=>{navigator.clipboard?.writeText(origin+'/?room='+code).then(()=>setMessage('参赛链接已复制。')).catch(()=>setMessage('参赛链接：'+origin+'/?room='+code));}}>复制参赛链接</button>{phase==='waiting'?<button className="primary" onClick={()=>action('start')} disabled={busy||!canStart}>{busy?'发车中…':canStart?'全场发车 →':'等待在线车手准备'}</button>:phase==='finished'?<button className="primary" disabled={busy} onClick={()=>action('reset')}>再来一局 →</button>:<span className="muted">等待本局结束后可再来一局</span>}</div>}
    {(message||(!connected&&error))&&<p className="screen-message" role="status">{message||error}</p>}</section><aside className="rank-panel"><div className="rank-title"><div><span className="eyebrow">{phase==='finished'?'OFFICIAL RESULTS':'LIVE RANKING'}</span><h2>{phase==='waiting'?'入场车手':phase==='finished'?'最终成绩':'实时排位'}</h2></div><span>{phase==='waiting'?'已加入 '+memberCount+' 人':'TOP '+Math.min(all.length,10)}</span></div><Scoreboard players={all} waiting={phase==='waiting'} limit={host&&phase==='waiting'?all.length:10} busy={busy} onRemove={host&&phase==='waiting'?id=>action('remove',{playerId:id}):undefined}/>{phase!=='waiting'&&origin&&<div className="mini-join"><Qr url={origin+'/?room='+code}/><span>下一局参赛入口<b>房间号 {code}</b></span></div>}<p className="rank-note">{phase==='waiting'?'在线车手全部准备后发车；断线 15 秒后计为离线。':phase==='finished'?'同距离按 0.1 米精度并列；完整成绩可在主持台导出':'按距离排名；同距离并列，例如 1、1、3。'}</p>{host&&phase==='finished'&&<button className="secondary wide" onClick={()=>downloadResults(code,room!.round,all)}>导出全部成绩 ↓</button>}{host&&<HistoryPanel code={code} rounds={data?.history||[]}/>}</aside></main>}
  </div>;
}
export function Driver({code,session,bootstrap,practice=false,review}:{code:string;session:Session;bootstrap:any;practice?:boolean;review?:DriverReview}){
  const state=useRef<RaceState>(bootstrap?.state||initialState()),seed=useRef(bootstrap?.room?.seed||47),pending=useRef<InputEvent[]>([]),ack=useRef(0);
  const participating=useRef(!!(practice||review||bootstrap?.participating)),rankTied=useRef(!!bootstrap?.tied);
  const controls=useRef<Control>(releasedControl()),lastRecorded=useRef<Control>(restoredControl(bootstrap?.state?.control));
  const localStart=useRef(Date.now()+3000),roomRef=useRef<Room>(bootstrap?.room||{code:'练习',round:1,seed:47,startAt:localStart.current,endAt:localStart.current+60000,settleAt:localStart.current+60000,serverNow:Date.now(),phase:'countdown'});
  const offset=useRef(bootstrap?.room?bootstrap.room.serverNow-Date.now():0),rank=useRef(bootstrap?.rank??0),lastHud=useRef(0),lastGood=useRef(Date.now()),[hud,setHud]=useState({speed:0,distance:0,time:60,rank:bootstrap?.rank??0,tied:false,phase:practice?'countdown':'waiting',count:3,nitro:0,hit:0,connection:true,hits:0,pickups:0});
  const[steering]=useState(()=>new RaceSteering(!!(practice||bootstrap?.ready),!!review?.calibrated));
  const driving=useSyncExternalStore(steering.subscribe,steering.getSnapshot,steering.getSnapshot);
  const steeringHint=driving.mode===null?'未选择驾驶方式':driving.mode==='buttons'?'按键驾驶 · ← → 转向':driving.canPrepare?'体感驾驶 · 倾斜转向':'体感未就绪 · 可改用按键';
  const[error,setError]=useState(''),touchSteer=useRef(0),keys=useRef(new Set<string>()),[ready,setReady]=useState(review?.ready??bootstrap?.ready??false),[roomCount,setRoomCount]=useState<number>(bootstrap?.count??1);
  const[participantCount,setParticipantCount]=useState<number>(bootstrap?.participantCount??0),[readyBusy,setReadyBusy]=useState(false),[leaving,setLeaving]=useState(false),[accessLost,setAccessLost]=useState('');
  const[showScores,setShowScores]=useState(false),readyStamp=useRef({round:bootstrap?.room?.round??1,readyVersion:bootstrap?.readyVersion??0,ready:!!bootstrap?.ready});
  const applyReady=useCallback((d:{room:Room;readyVersion:number;ready:boolean})=>{
    const next=acceptReadiness(readyStamp.current,{round:d.room.round,readyVersion:d.readyVersion,ready:d.ready});
    readyStamp.current=next;setReady(next.ready);
  },[]);
  const setControl=(key:'throttle'|'drift',value:boolean)=>{controls.current[key]=value;};
  const releaseAll=useCallback(()=>{controls.current={throttle:false,drift:false,steer:0};touchSteer.current=0;keys.current.clear();},[]);
  async function changeReady(){
    if(!ready&&!steering.getSnapshot().canPrepare)return;
    if(review){setReady(!ready);return;}
    setReadyBusy(true);setError('');
    try{const d=await api({action:'ready',code,token:session.token,round:roomRef.current.round,readyVersion:readyStamp.current.readyVersion,ready:!ready});applyReady(d);}
    catch(e){setError((e as Error).message);if((e as {status?:number}).status===409){try{applyReady(await api({action:'resume',code,token:session.token}));}catch{}}}finally{setReadyBusy(false);}
  }
  async function leaveRoom(){
    if(practice||review){location.href='/';return;}
    setLeaving(true);releaseAll();
    try{await api({action:'leave',code,token:session.token});jsonStore.remove('race-player-'+code);location.href='/';}
    catch(e){setError((e as Error).message);setLeaving(false);}
  }
  useEffect(()=>{
    const orientation=(event:DeviceOrientationEvent)=>steering.observe(event.gamma);
    const down=(e:KeyboardEvent)=>{if(['ArrowLeft','ArrowRight','ArrowUp',' ','Shift'].includes(e.key)){e.preventDefault();keys.current.add(e.key);}};
    const up=(e:KeyboardEvent)=>keys.current.delete(e.key);
    const visibility=()=>{if(document.hidden)releaseAll();};
    window.addEventListener('deviceorientation',orientation);window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',releaseAll);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('deviceorientation',orientation);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',releaseAll);document.removeEventListener('visibilitychange',visibility);steering.dispose();};
  },[releaseAll,steering]);
  function chooseButtons(){releaseAll();steering.useButtons();}
  async function enableSensor(){
    releaseAll();
    await steering.useSensor(async()=>{
      const Device=window.DeviceOrientationEvent as typeof DeviceOrientationEvent&{requestPermission?:()=>Promise<string>};
      if(!Device)throw new Error('此设备没有体感传感器，请改用按键驾驶。');
      return Device.requestPermission?await Device.requestPermission():'granted';
    });
  }
  useEffect(()=>{if(practice||review||accessLost||leaving)return;let alive=true,busy=false;
    async function sync(){if(busy)return;busy=true;const before=Date.now();try{
      const r=roomRef.current,isRace=participating.current&&r.startAt!==null&&Date.now()+offset.current>=r.startAt;
      const until=state.current.tick;
      const d=await api({action:isRace?'input':'resume',code,token:session.token,round:r.round,until,events:pending.current.filter(e=>e.tick>=ack.current&&e.tick<=until)});
      if(!alive||d.room.round<roomRef.current.round)return;
      const midpoint=(before+Date.now())/2;offset.current=d.room.serverNow-midpoint;
      if(d.room.round!==r.round){state.current=d.state;pending.current=[];ack.current=0;lastRecorded.current=restoredControl(d.state.control);releaseAll();setShowScores(false);}
      else if(d.state&&d.state.tick>=ack.current){
        const target=state.current.tick;ack.current=d.state.tick;pending.current=pending.current.filter(e=>e.tick>=ack.current);
        const corrected:RaceState=d.state;advance(corrected,target,pending.current,d.room.seed);state.current=corrected;
      }
      roomRef.current=d.room;seed.current=d.room.seed;rank.current=d.rank??0;rankTied.current=!!d.tied;participating.current=!!d.participating;applyReady(d);
      if(typeof d.count==='number')setRoomCount(d.count);if(typeof d.participantCount==='number')setParticipantCount(d.participantCount);lastGood.current=Date.now();setError('');
    }catch(e){if(alive){setError((e as Error).message);if((e as {status?:number}).status===409){
      try{const d=await api({action:'resume',code,token:session.token});if(alive&&d.room.round>=roomRef.current.round){if(d.room.round!==roomRef.current.round){setShowScores(false);releaseAll();}roomRef.current=d.room;seed.current=d.room.seed;state.current=d.state;pending.current=[];ack.current=d.state.tick;offset.current=d.room.serverNow-Date.now();lastRecorded.current=restoredControl(d.state.control);participating.current=!!d.participating;rank.current=d.rank??0;rankTied.current=!!d.tied;applyReady(d);if(typeof d.participantCount==='number')setParticipantCount(d.participantCount);}}catch{}
    }else if((e as {status?:number}).status===410){releaseAll();jsonStore.remove('race-player-'+code);setAccessLost((e as Error).message);}
    }}finally{busy=false;}}
    sync();const timer=setInterval(sync,500);return()=>{alive=false;clearInterval(timer);};
  },[code,session.token,practice,releaseAll,review,accessLost,leaving,applyReady]);
  const frame=useCallback((time:number)=>{
    const r=roomRef.current,now=review?.now??Date.now()+offset.current;
    let phase='waiting',count=0,target=0;
    if(r.startAt!==null){target=clamp(Math.floor((now-r.startAt)*.06),0,RACE_TICKS);phase=now<r.startAt?'countdown':now<r.startAt+60000?'racing':practice?'finished':now<r.startAt+65000?'settling':'finished';count=Math.ceil((r.startAt-now)/1000);}
    if(!practice&&!review&&r.startAt!==null&&!participating.current){target=0;phase='spectating';}
    const s=state.current;
    if(review){phase=review.phase;target=s.tick;}
    let frames=Math.min(180,Math.max(0,target-s.tick));
    while(frames-->0){
      const keyboard=(keys.current.has('ArrowRight')?1:0)-(keys.current.has('ArrowLeft')?1:0);
      const tilt=steering.readSteer();
      const desired={throttle:controls.current.throttle||keys.current.has('ArrowUp')||keys.current.has(' '),drift:controls.current.drift||keys.current.has('Shift'),steer:Math.round((keyboard||touchSteer.current||tilt)*20)/20};
      // Sample steering at 10 Hz; button changes take effect on the next physics frame.
      const sampled=sampleControl(s.tick,lastRecorded.current,desired);
      if(sampled.event){pending.current.push(sampled.event);lastRecorded.current=sampled.control;}
      s.control={...sampled.control};step(s,seed.current);
    }
    if(practice)pending.current=[];
    if(time-lastHud.current>80){lastHud.current=time;setHud({speed:s.speed,distance:s.distance,time:Math.max(0,Math.ceil((RACE_TICKS-s.tick)/60)),rank:rank.current,tied:rankTied.current,phase,count,nitro:nitroMultiplier(s)-1,hit:Math.max(0,(Math.max(s.hitUntil,s.wallUntil??0)-s.tick)/60),connection:!!review||practice||Date.now()-lastGood.current<3500,hits:s.hits+(s.wallHits??0),pickups:s.pickups});}
  },[practice,review,steering]);
  function retry(){state.current=initialState();pending.current=[];ack.current=0;releaseAll();roomRef.current={...roomRef.current,startAt:Date.now()+3000,endAt:Date.now()+63000};setReady(true);}
  if(accessLost)return <div className="utility-page"><div className="utility-card"><h1>已离开房间</h1><p role="status">{accessLost}</p><a className="primary" href="/">返回首页</a></div></div>;
  return <div className="driver-outer"><div className="phone-game"><header className="driver-top"><a href="/" aria-label={practice?'返回首页':'退出房间'} onClick={e=>{e.preventDefault();if(!leaving)leaveRoom();}}>←</a><b>{practice?'自由试驾':'极速热场'}<small>{practice?'不计正式成绩':'房间 '+code+' · 在线 '+roomCount+' 人'}</small></b><span className={hud.connection?'online':'offline'}>{hud.connection?'● 已连接':'● 重连中'}</span></header>
    <div className="drive-viewport"><RaceCanvas state={state} seed={seed} color={session.player.color} frame={frame}/><div className="driver-hud"><div><small>剩余时间</small><strong>{String(hud.time).padStart(2,'0')}<em>s</em></strong></div><div><small>{practice?'已行驶':hud.tied?'并列排名':'当前排名'}</small><strong>{practice?Math.round(hud.distance):hud.rank>0?'#'+hud.rank:'—'}<em>{practice?'m':''}</em></strong></div></div>
      <div className="nitro-meter" aria-hidden="true"><i style={{width:`${Math.max(0,hud.nitro/.3)*100}%`}}/></div><div className="effect-chips">{hud.nitro>0&&<span className="nitro-chip">氮气 +{Math.round(hud.nitro*100)}%</span>}{hud.hit>0&&<span className="hit-chip">碰撞减速 {hud.hit.toFixed(1)}s</span>}</div>
      {hud.phase==='waiting'&&<div className="game-overlay waiting-overlay"><span className="eyebrow">YOU'RE ON THE GRID</span>{car(session.player.color)}<h2>{ready?'车手已就位':'欢迎入场，'+session.player.name}</h2><p>保持竖屏，双手握稳手机。<br/>{ready?'准备状态已同步，等待主持人发车。':'先选驾驶方式，就绪后点击准备。'}</p><div className="pickup-guide"><span><img src="/assets/gameplay/nitro-n2o.png" alt="蓝色氮气瓶"/>氮气 +30%</span><span><img src="/assets/racing/barrier_red_race.png" alt="橙色路障"/>障碍 −50%</span></div><div className="driving-modes" role="group" aria-label="驾驶方式"><button className={driving.mode==='sensor'?'primary':'secondary'} aria-label="体感驾驶" aria-pressed={driving.mode==='sensor'} disabled={ready||readyBusy||driving.status==='requesting'||driving.status==='calibrating'} onClick={enableSensor}>{driving.status==='error'?'重试体感驾驶':'体感驾驶'}</button><button className={driving.mode==='buttons'?'primary':'secondary'} aria-pressed={driving.mode==='buttons'} disabled={ready||readyBusy} onClick={chooseButtons}>{driving.status==='error'?'改用按键驾驶':'按键驾驶'}</button></div><p className="sensor-status" role="status">{driving.message}{ready&&' 更改方式请先取消准备。'}</p><button className="secondary" disabled={readyBusy||leaving||(!ready&&!driving.canPrepare)} aria-pressed={ready} onClick={changeReady}>{readyBusy?'正在同步…':ready?'已准备 · 点击取消':driving.canPrepare?'我已准备':driving.mode===null?'先选择驾驶方式':driving.status==='error'?'体感未就绪':'等待体感校准…'}</button><span className="overlay-room">房间号 {code} · 在线 {roomCount} 人</span>{error&&<p className="lobby-error" role="alert">{error}</p>}</div>}
      {hud.phase==='spectating'&&<div className="game-overlay spectator-overlay"><h2>本局未参赛</h2><p>本局已锁定参赛名单。<br/>保持在线，等待主持人开启下一局。</p><button className="secondary" onClick={()=>setShowScores(true)}>查看全场比赛</button><button className="secondary" disabled={leaving} onClick={leaveRoom}>退出房间</button></div>}
      {hud.phase==='countdown'&&<div className="game-overlay countdown-overlay"><strong>{Math.max(1,hud.count)}</strong><h2>准备发车</h2><p>右下加速 · 左下漂移</p><p>{steeringHint}</p></div>}
      {(hud.phase==='settling'||hud.phase==='finished')&&<div className="game-overlay finish-overlay"><span className="eyebrow">{practice?'PRACTICE COMPLETE':hud.phase==='finished'?'RACE COMPLETE':'FINISH LINE'}</span><h2>{practice?'试驾完成！':hud.phase==='finished'?'比赛结束':'已完成比赛'}</h2><img className="finish-trophy" src="/assets/ville/victory.png" alt="赛车奖杯"/><div className="finish-distance">{formatDistance(hud.distance)}<small>米</small></div><p>{practice?'氮气 '+hud.pickups+' 次 · 碰撞 '+hud.hits+' 次':hud.phase==='finished'?(hud.tied?'最终并列第 '+hud.rank+' 名':'最终排名 #'+hud.rank)+' / '+(participantCount||roomCount)+' 人':'正在同步全场成绩，请稍候…'}</p>{practice?<button className="primary" onClick={retry}>再试一圈 →</button>:<button className="primary" onClick={()=>setShowScores(true)}>查看全场成绩</button>}<a href="/" className="finish-home" onClick={e=>{e.preventDefault();if(!leaving)leaveRoom();}}>退出并返回首页</a></div>}
      {showScores&&<DriverScores code={code} onClose={()=>setShowScores(false)}/>}
      <div className="drive-bottom-info"><span>{hud.distance.toFixed(0)} m</span><span>{hud.phase==='racing'&&hud.time<=10?'最后冲刺！':steeringHint}</span></div>
    </div>
    <div className="driver-controls"><div className="steer-buttons"><button aria-label="向左转向" onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);touchSteer.current=-1;}} onPointerUp={()=>touchSteer.current=0} onPointerCancel={()=>touchSteer.current=0} onLostPointerCapture={()=>touchSteer.current=0}>←</button><button className="calibrate" disabled={readyBusy||(!practice&&hud.phase==='waiting'&&ready)} onClick={driving.mode==='sensor'?chooseButtons:enableSensor}>{driving.mode==='sensor'?'体感驾驶 · 改用按键':driving.mode==='buttons'?'按键驾驶 · 切换体感':'选择体感驾驶'}</button><button aria-label="向右转向" onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);touchSteer.current=1;}} onPointerUp={()=>touchSteer.current=0} onPointerCancel={()=>touchSteer.current=0} onLostPointerCapture={()=>touchSteer.current=0}>→</button></div><div className="main-controls"><HoldButton label="漂移" hint="按住过弯" color="blue" onHold={v=>setControl('drift',v)}/><div className="speed-readout" role="group" aria-label="实时车速">实时车速<strong>{hud.phase==='racing'?Math.round(hud.speed):0}<small>码</small></strong></div><HoldButton label="加速" hint="按住提速" color="yellow" onHold={v=>setControl('throttle',v)}/></div></div>
    {error&&!hud.connection&&<div className="network-toast" role="status">网络较慢，正在自动重连；驾驶操作会继续记录。</div>}</div><p className="desktop-help">电脑试玩：← → 转向 · ↑ / 空格加速 · Shift 漂移</p></div>;
}
export default function GameApp(){
  const[route,setRoute]=useState<Record<string,string>|null>(null),[session,setSession]=useState<Session|null>(null),[bootstrap,setBootstrap]=useState<any>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const query=Object.fromEntries(new URLSearchParams(location.search));setRoute(query);
    if(query.room){const saved=jsonStore.get('race-player-'+query.room);if(saved){setLoading(true);api({action:'resume',code:query.room,token:saved.token}).then(d=>{setBootstrap(d);setSession(saved);}).catch(e=>{setError(e.message);if(e.status===401||e.status===410)jsonStore.remove('race-player-'+query.room);}).finally(()=>setLoading(false));}}
  },[]);
  const joined=(code:string,s:Session,d:any)=>{history.replaceState(null,'','/?room='+code);setRoute({room:code});setBootstrap(d);setSession(s);};
  if(!route)return <div className="boot"><Brand/><p>赛道准备中…</p></div>;
  if(route.practice)return <Driver code="practice" practice session={{token:'practice',player:{id:'practice',name:'试驾车手',color:'blue'}}} bootstrap={null}/>;
  if(route.host||route.screen)return <RoomView code={route.host||route.screen} host={!!route.host}/>;
  if(route.mode==='join')return <JoinScreen onJoin={joined}/>;
  if(route.mode)return <RoomPicker mode={route.mode}/>;
  if(route.room){if(loading)return <div className="boot"><Brand/><p>正在找回你的赛车…</p></div>;
    if(session)return <Driver code={route.room} session={session} bootstrap={bootstrap}/>;
    return <div className="mobile-join"><Brand/><div className="join-card">{error&&<p className="error">{error}</p>}<JoinForm initialCode={route.room} onJoin={joined}/></div><a className="secondary" href="/?practice=1">单人试驾</a><Credits/></div>;
  }
  return <Landing onJoin={joined}/>;
}
