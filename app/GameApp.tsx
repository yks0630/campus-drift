'use client';
import {useCallback,useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import QRCode from 'qrcode';
import RaceCanvas from './RaceCanvas';
import {advance,clamp,COLORS,initialState,nitroMultiplier,RACE_TICKS,step,trackObject,type Control,type InputEvent,type RaceState} from '@/lib/race-sim';

type Room={code:string;round:number;seed:number;startAt:number|null;endAt:number|null;settleAt:number|null;serverNow:number;phase:string};
type Player={id:string;name:string;color:string;distance:number;speed:number;rank:number;connected:boolean};
type Snapshot={room:Room;players:Player[];count:number};
type Session={token:string;player:Pick<Player,'id'|'name'|'color'>};
const ASSET='/assets/racing/';
const colorNames:Record<string,string>={blue:'海盐蓝',red:'烈焰红',green:'薄荷绿',yellow:'闪电黄',black:'曜石黑'};
const jsonStore={get:(key:string)=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}},set:(key:string,value:unknown)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}},remove:(key:string)=>{try{localStorage.removeItem(key);}catch{}}};
async function api(body:Record<string,unknown>){
  const response=await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(7000)});
  const data:any=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'连接失败，请重试。'),{status:response.status});return data;
}
function car(color:string,className=''){return <img className={className} src={ASSET+'car_'+color+'_1.png'} alt={colorNames[color]+'赛车'}/>;}
function Brand(){return <a className="brand" href="/">{car('yellow')}<span>极速热场<small>CAMPUS GRAND PRIX</small></span></a>;}
function Tag({children}:{children:React.ReactNode}){return <span className="tag"><i/>{children}</span>;}
function HoldButton({label,hint,color,onHold,kind='round'}:{label:string;hint:string;color:string;onHold:(held:boolean)=>void;kind?:string}){
  const[held,setHeld]=useState(false);
  const release=()=>{setHeld(false);onHold(false);};
  return <button className={'drive-button '+(held?'held':'')} style={{backgroundImage:`url(/assets/ui/${color}_button_${kind}_depth_gloss.png)`}}
    aria-label={label} aria-pressed={held} onContextMenu={e=>e.preventDefault()}
    onPointerDown={(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setHeld(true);onHold(true);}}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
    <strong>{label}</strong><small>{hint}</small></button>;
}
function useSnapshot(code:string){
  const[data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[connected,setConnected]=useState(true);
  useEffect(()=>{let alive=true,busy=false,controller:AbortController|null=null;
    async function load(){if(busy)return;busy=true;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),6000);
      try{const response=await fetch('/api/game?code='+code,{cache:'no-store',signal:controller.signal});const json:any=await response.json();
        if(!response.ok)throw new Error(json.error);if(alive){setData(json);setError('');setConnected(true);}}
      catch(e){if(alive){setConnected(false);setError(e instanceof Error?e.message:'正在重新连接');}}
      finally{clearTimeout(timeout);busy=false;}}
    load();const timer=setInterval(load,900);return()=>{alive=false;clearInterval(timer);controller?.abort();};
  },[code]);return {data,error,connected};
}
function JoinForm({initialCode='',onJoin}:{initialCode?:string;onJoin:(code:string,session:Session,data:any)=>void}){
  const[code,setCode]=useState(initialCode),[name,setName]=useState(''),[color,setColor]=useState('blue'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setName(jsonStore.get('race-name')||'');},[]);
  async function join(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');
    try{const data=await api({action:'join',code,name,color});const session={token:data.token,player:data.player};jsonStore.set('race-player-'+code,session);jsonStore.set('race-name',name);onJoin(code,session,data);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <form className="join-form" onSubmit={join}>
    <div className="form-heading"><span className="eyebrow">SELECT YOUR RIDE</span><h2>选择赛车，进入发车区。</h2><p>输入大屏上的房间号，准备一起发车。</p></div>
    <label>房间号<input aria-label="房间号" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="off" placeholder="输入 6 位房间号" pattern="[0-9]{6}" required maxLength={6}/></label>
    <label>车手昵称<input aria-label="车手昵称" value={name} onChange={e=>setName(e.target.value)} placeholder="大屏上闪亮登场的名字" maxLength={12} required autoComplete="nickname"/></label>
    <fieldset><legend>选一辆你的赛车</legend><div className="car-picker">{COLORS.map(c=><button type="button" key={c} title={colorNames[c]} aria-label={colorNames[c]} aria-pressed={color===c} className={color===c?'selected':''} onClick={()=>setColor(c)}>{car(c)}</button>)}</div></fieldset>
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="primary wide" disabled={busy}>{busy?'正在驶入发车区…':'加入比赛 →'}</button>
    <p className="form-note">无需下载 · 手机竖屏 · 每局 60 秒</p>
  </form>;
}
function Demo(){
  const state=useRef(initialState()),seed=useRef(47),last=useRef(0);
  const frame=useCallback((time:number)=>{if(!last.current)last.current=time;
    let frames=Math.min(5,Math.floor((time-last.current)/1000*60));last.current+=frames*1000/60;
    while(frames-->0){const s=state.current;if(s.tick>=RACE_TICKS)state.current=initialState();
      const object=trackObject(s.nextObject,seed.current);s.control={throttle:true,drift:false,steer:clamp((object.type==='nitro'?object.x:object.x>0?-.4:.4)-s.x,-1,1)};step(s,seed.current);}
  },[]);
  return <div className="demo-track"><RaceCanvas state={state} seed={seed} color="blue" frame={frame}/><div className="demo-top"><Tag>操作演示</Tag><span>60 秒，尽情超越</span></div><div className="demo-card"><img src={ASSET+'barrel_blue.png'} alt="氮气"/><span>拾取氮气<strong>速度提升 30%</strong></span><b>3s</b></div><div className="demo-caption">左右倾斜，弯道见真章。</div></div>;
}
function Landing({onJoin}:{onJoin:(code:string,s:Session,d:any)=>void}){
  return <div className="landing"><header className="site-header"><Brand/><nav><a href="#how">玩法说明</a><a href="/?mode=screen">大屏观战 ↗</a><a className="nav-host" href="/?mode=host">主持人入口</a></nav></header>
    <main className="hero"><section className="hero-copy"><Tag>全场一起，极速开场</Tag><h1>全场就位。<br/>现在，<span>开跑。</span></h1><p className="hero-description">一场属于全场的 60 秒竞速。<br/>倾斜转向，漂移过弯，让你的名字冲上大屏。</p>
      <div className="hero-stats"><div><b>60<small>秒</small></b><span>一局尽兴</span></div><div><b>100<small>人</small></b><span>同场竞技上限</span></div><div><b>156<small>码</small></b><span>氮气最高速度</span></div></div>
      <a className="practice-link" href="/?practice=1">先试一圈 <span>↗</span><small>熟悉转向和漂移，不计正式成绩</small></a>
      <div className="hero-assets">美术素材 / Kenney Racing Pack · CC0</div></section>
      <section className="hero-play"><Demo/><div className="join-card"><JoinForm onJoin={onJoin}/></div></section>
    </main>
    <section className="how-section" id="how"><div className="how-title"><span className="eyebrow">HOW TO RACE</span><h2>三步上赛道，全场一起嗨。</h2></div>
      <div className="how-grid"><article><b>01</b><h3>竖起手机，左右倾斜</h3><p>开启体感并校准握姿，转向就像握着方向盘。也支持触控方向键。</p></article><article><b>02</b><h3>按住加速，漂移过弯</h3><p>右下加速、左下漂移。松开加速后，赛车会逐渐回到 30 码巡航。</p></article><article><b>03</b><h3>吃到氮气，冲上排名</h3><p>氮气提速 30%，障碍减速 50%。坚持到最后，按前进距离决胜。</p></article></div></section>
    <footer><Brand/><span>倾斜手机 · 放大热情</span><a href="/assets/racing-pack-LICENSE.txt">素材许可 ↗</a></footer></div>;
}
function RoomPicker({mode}:{mode:string}){
  const[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function create(){setBusy(true);setError('');try{const d=await api({action:'create'});jsonStore.set('race-host-'+d.room.code,d.hostToken);location.href='/?host='+d.room.code;}catch(e){setError((e as Error).message);setBusy(false);}}
  return <div className="utility-page"><header><Brand/><a href="/">返回首页</a></header><div className="utility-card"><span className="eyebrow">{mode==='host'?'RACE CONTROL':'LIVE LEADERBOARD'}</span><h1>{mode==='host'?'让全场，准备发车。':'把精彩，放上大屏。'}</h1><p>{mode==='host'?'创建房间，投屏二维码，学生扫码后统一开始。':'输入房间号，打开横屏实时排名。'}</p>
    {mode==='host'?<button className="primary wide" onClick={create} disabled={busy}>{busy?'正在创建房间…':'创建比赛房间 →'}</button>:<form onSubmit={e=>{e.preventDefault();location.href='/?screen='+code;}}><label>房间号<input aria-label="房间号" inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} maxLength={6} required placeholder="输入六位房间号"/></label><button className="primary wide">打开实时大屏 →</button></form>}
    {error&&<p className="error" role="alert">{error}</p>}<div className="utility-art">{['yellow','red','blue','green'].map(c=>car(c))}</div></div></div>;
}
function Qr({url}:{url:string}){
  const[src,setSrc]=useState('');useEffect(()=>{let active=true;QRCode.toDataURL(url,{width:280,margin:2,color:{dark:'#111d2d',light:'#ffffff'}}).then(s=>{if(active)setSrc(s);});return()=>{active=false;};},[url]);
  return src?<img className="qr" src={src} alt="扫码加入此房间"/>:<div className="qr-placeholder">正在生成二维码…</div>;
}
function Scoreboard({players,limit=10}:{players:Player[];limit?:number}){
  return <div className="scoreboard"><div className="score-heading"><span>名次 / 车手</span><span>前进距离</span></div>{players.slice(0,limit).map(p=><div className={'score-row place-'+p.rank} key={p.id}><b>{String(p.rank).padStart(2,'0')}</b>{car(p.color)}<span className="player-name">{p.name}</span><strong>{p.distance.toFixed(1)}<small> m</small></strong></div>)}{!players.length&&<div className="empty-rank">第一位车手，会是你吗？<span>扫码加入，准备让全场记住你的名字。</span></div>}</div>;
}
function RoomView({code,host=false}:{code:string;host?:boolean}){
  const{data,error,connected}=useSnapshot(code),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[origin,setOrigin]=useState(''),[now,setNow]=useState(Date.now());
  useEffect(()=>{setOrigin(location.origin);const t=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(t);},[]);
  const room=data?.room,clockOffset=useRef(0);
  useEffect(()=>{if(data)clockOffset.current=data.room.serverNow-Date.now();},[data]);
  const clock=now+clockOffset.current;
  async function action(name:string){setBusy(true);setMessage('');try{await api({action:name,code,hostToken:jsonStore.get('race-host-'+code)});}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  const phase=room?.phase||'waiting',end=room?.endAt||0;
  let timer='60';if(phase==='countdown')timer=String(Math.max(1,Math.ceil(((room?.startAt||0)-clock)/1000)));else if(phase==='racing')timer=String(Math.max(0,Math.ceil((end-clock)/1000)));
  const phaseText:Record<string,string>={waiting:'等待车手集结',countdown:'准备发车',racing:'比赛进行中',settling:'成绩确认中',finished:'本场比赛结束'};
  const all=data?.players||[];
  return <div className={'race-screen '+(host?'host-screen':'')}><header><Brand/><Tag>{connected?'实时连接':'正在重连'}</Tag><div className="room-label">房间号 <b>{code}</b></div><button className="ghost" onClick={()=>document.documentElement.requestFullscreen?.().catch(()=>{})}>全屏 ↗</button></header>
    {!data&&error?<div className="screen-error"><h2>{error}</h2><a href="/">返回首页</a></div>:<main className="screen-grid"><section className="live-stage"><div className="stage-top"><div><span className="eyebrow">{phase==='finished'?'FINAL RESULTS':'CAMPUS GRAND PRIX / LIVE'}</span><h1>{phase==='finished'?'这一刻，为你喝彩。':phase==='waiting'?'全场就位，即刻开跑。':'每一次超越，都值得欢呼。'}</h1></div><div className={'race-clock '+(phase==='racing'&&Number(timer)<=10?'urgent':'')}><span>{phaseText[phase]}</span><strong>{phase==='finished'?'FIN':phase==='settling'?'…':timer}</strong><small>{phase==='racing'?'SECONDS LEFT':'60 秒 · 距离排位赛'}</small></div></div>
    {phase==='waiting'?<div className="waiting-stage"><div className="waiting-qr">{origin&&<Qr url={origin+'/?room='+code}/>}<strong>扫码入场，竖屏开跑</strong><span>房间号 {code} · 无需下载</span></div><div className="waiting-cars">{COLORS.slice(0,4).map((c,i)=><div key={c} style={{transform:`translateY(${i%2*34}px)`}}>{car(c)}<span>{colorNames[c]}</span></div>)}</div></div>
      :phase==='finished'?<div className="podium">{[1,0,2].map(index=>{const p=all[index];return <div key={index} className={'podium-place position-'+(index+1)}>{p?<> {car(p.color)}<h2>{p.name}</h2><p>{p.distance.toFixed(1)} m</p><strong>{index===0?'冠军':index===1?'亚军':'季军'} <b>{index+1}</b></strong></>:<span>—</span>}</div>;})}</div>
      :<div className="race-lanes">{all.slice(0,6).map((p,i)=><div className="race-lane" key={p.id}><span>{p.rank}<b>{p.name}</b></span><div className="lane-road" style={{backgroundImage:`url(${ASSET}road_asphalt01.png)`}}><div className="lane-car" style={{left:`${8+p.distance/Math.max(100,...all.map(v=>v.distance))*77}%`}}>{car(p.color)}<small>{Math.round(p.speed)} 码</small></div></div><strong>{p.distance.toFixed(0)} m</strong></div>)}{phase==='countdown'&&<div className="screen-countdown">{timer}<small>准备发车</small></div>}{phase==='settling'&&<div className="settling-banner">比赛已结束，正在等待最后的成绩同步…</div>}</div>}
    <div className="stage-footer"><span><i/>{data?.count||0} / 100 位车手</span><span>倾斜转向 · 左下漂移 · 右下加速</span><b>60 秒，看谁更远。</b></div>
    {host&&<div className="host-actions"><a className="secondary" href={'/?room='+code} target="_blank" rel="noreferrer">用这台设备参赛 ↗</a><a className="secondary" href={'/?screen='+code} target="_blank" rel="noreferrer">打开纯大屏 ↗</a><button className="secondary" onClick={()=>{navigator.clipboard?.writeText(origin+'/?room='+code).then(()=>setMessage('参赛链接已复制。')).catch(()=>setMessage('参赛链接：'+origin+'/?room='+code));}}>复制参赛链接</button>{phase==='waiting'?<button className="primary" onClick={()=>action('start')} disabled={busy||!data?.count}>{busy?'发车中…':'全场发车 →'}</button>:phase==='finished'?<button className="primary" disabled={busy} onClick={()=>action('reset')}>再来一局 →</button>:<span className="muted">等待本局结束后可再来一局</span>}</div>}
    {(message||(!connected&&error))&&<p className="screen-message" role="status">{message||error}</p>}</section><aside className="rank-panel"><div className="rank-title"><div><span className="eyebrow">{phase==='finished'?'OFFICIAL RESULTS':'LIVE RANKING'}</span><h2>{phase==='finished'?'最终成绩':'实时排位'}</h2></div><span>TOP {Math.min(all.length,10)}</span></div><Scoreboard players={all}/>{phase!=='waiting'&&origin&&<div className="mini-join"><Qr url={origin+'/?room='+code}/><span>下一局，轮到你。<b>房间号 {code}</b></span></div>}<p className="rank-note">{phase==='finished'?'完整成绩可在主持台导出':'排名按前进距离更新，最终以结算成绩为准'}</p>{host&&phase==='finished'&&<button className="secondary wide" onClick={()=>{const csv='\uFEFF名次,昵称,距离（米）\n'+all.map(p=>[p.rank,'"'+p.name.replace(/"/g,'""').replace(/^[=+@\-]/,"'$&")+'"',p.distance.toFixed(2)].join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='极速热场-'+code+'-第'+room?.round+'局.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>导出全部成绩 ↓</button>}</aside></main>}
  </div>;
}
function Driver({code,session,bootstrap,practice=false}:{code:string;session:Session;bootstrap:any;practice?:boolean}){
  const state=useRef<RaceState>(bootstrap?.state||initialState()),seed=useRef(bootstrap?.room?.seed||47),pending=useRef<InputEvent[]>([]),ack=useRef(0);
  const controls=useRef<Control>({throttle:false,drift:false,steer:0}),lastRecorded=useRef<Control>({throttle:false,drift:false,steer:0});
  const localStart=useRef(Date.now()+3000),roomRef=useRef<Room>(bootstrap?.room||{code:'练习',round:1,seed:47,startAt:localStart.current,endAt:localStart.current+60000,settleAt:localStart.current+60000,serverNow:Date.now(),phase:'countdown'});
  const offset=useRef(bootstrap?.room?bootstrap.room.serverNow-Date.now():0),rank=useRef(bootstrap?.rank||1),lastHud=useRef(0),lastGood=useRef(Date.now()),[hud,setHud]=useState({speed:0,distance:0,time:60,rank:1,phase:practice?'countdown':'waiting',count:3,nitro:0,hit:0,connection:true,hits:0,pickups:0});
  const[sensor,setSensor]=useState('未开启体感'),[error,setError]=useState(''),[calibrated,setCalibrated]=useState(false),gamma=useRef<number|null>(null),baseline=useRef<number|null>(null),sensorEnabled=useRef(false),touchSteer=useRef(0),keys=useRef(new Set<string>()),[ready,setReady]=useState(false);
  const setControl=(key:'throttle'|'drift',value:boolean)=>{controls.current[key]=value;};
  const releaseAll=useCallback(()=>{controls.current={throttle:false,drift:false,steer:0};touchSteer.current=0;keys.current.clear();},[]);
  useEffect(()=>{
    const orientation=(event:DeviceOrientationEvent)=>{if(!sensorEnabled.current||event.gamma===null)return;gamma.current=event.gamma;if(baseline.current===null){baseline.current=event.gamma;setCalibrated(true);setSensor('体感已就绪');}};
    const down=(e:KeyboardEvent)=>{if(['ArrowLeft','ArrowRight','ArrowUp',' ','Shift'].includes(e.key)){e.preventDefault();keys.current.add(e.key);}};
    const up=(e:KeyboardEvent)=>keys.current.delete(e.key);
    const visibility=()=>{if(document.hidden)releaseAll();};
    window.addEventListener('deviceorientation',orientation);window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',releaseAll);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('deviceorientation',orientation);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',releaseAll);document.removeEventListener('visibilitychange',visibility);};
  },[releaseAll]);
  async function enableSensor(){
    try{
      const Device=window.DeviceOrientationEvent as typeof DeviceOrientationEvent&{requestPermission?:()=>Promise<string>};
      if(!Device)throw new Error('此设备没有体感传感器，请用方向键。');
      if(Device.requestPermission&&await Device.requestPermission()!=='granted')throw new Error('未获得体感权限，可用下方方向键转向。');
      sensorEnabled.current=true;baseline.current=null;setSensor('请握稳手机，等待校准…');
      setTimeout(()=>{if(baseline.current===null){setSensor('尚未收到体感数据，可用方向键');}},2500);
    }catch(e){setSensor((e as Error).message);}
  }
  useEffect(()=>{if(practice)return;let alive=true,busy=false;
    async function sync(){if(busy)return;busy=true;const before=Date.now();try{
      const r=roomRef.current,isRace=r.startAt!==null&&Date.now()+offset.current>=r.startAt;
      const until=state.current.tick;
      const d=await api({action:isRace?'input':'resume',code,token:session.token,round:r.round,until,events:pending.current.filter(e=>e.tick>=ack.current&&e.tick<=until)});
      if(!alive)return;
      const midpoint=(before+Date.now())/2;offset.current=d.room.serverNow-midpoint;
      if(d.room.round!==r.round){state.current=d.state;pending.current=[];ack.current=0;lastRecorded.current={throttle:false,drift:false,steer:0};releaseAll();setReady(false);}
      else if(d.state&&d.state.tick>=ack.current){
        const target=state.current.tick;ack.current=d.state.tick;pending.current=pending.current.filter(e=>e.tick>=ack.current);
        const corrected:RaceState=d.state;advance(corrected,target,pending.current,d.room.seed);state.current=corrected;
      }
      roomRef.current=d.room;seed.current=d.room.seed;rank.current=d.rank||1;lastGood.current=Date.now();setError('');
    }catch(e){if(alive){setError((e as Error).message);if((e as {status?:number}).status===409){
      try{const d=await api({action:'resume',code,token:session.token});if(alive){roomRef.current=d.room;seed.current=d.room.seed;state.current=d.state;pending.current=[];ack.current=d.state.tick;offset.current=d.room.serverNow-Date.now();lastRecorded.current={...d.state.control};}}catch{}
    }}}finally{busy=false;}}
    sync();const timer=setInterval(sync,500);return()=>{alive=false;clearInterval(timer);};
  },[code,session.token,practice,releaseAll]);
  const frame=useCallback((time:number)=>{
    const r=roomRef.current,now=Date.now()+offset.current;
    let phase='waiting',count=0,target=0;
    if(r.startAt!==null){target=clamp(Math.floor((now-r.startAt)*.06),0,RACE_TICKS);phase=now<r.startAt?'countdown':now<r.startAt+60000?'racing':practice?'finished':now<r.startAt+65000?'settling':'finished';count=Math.ceil((r.startAt-now)/1000);}
    const s=state.current;
    let frames=Math.min(180,Math.max(0,target-s.tick));
    while(frames-->0){
      const keyboard=(keys.current.has('ArrowRight')?1:0)-(keys.current.has('ArrowLeft')?1:0);
      let tilt=sensorEnabled.current&&gamma.current!==null&&baseline.current!==null?clamp((gamma.current-baseline.current)/22,-1,1):0;
      if(Math.abs(tilt)<.08)tilt=0;
      const desired={throttle:controls.current.throttle||keys.current.has('ArrowUp')||keys.current.has(' '),drift:controls.current.drift||keys.current.has('Shift'),steer:Math.round((keyboard||touchSteer.current||tilt)*20)/20};
      // Sample steering at 10 Hz; button changes take effect on the next physics frame.
      const old=lastRecorded.current,next={...desired,steer:s.tick%6===0?desired.steer:old.steer};
      if(next.throttle!==old.throttle||next.drift!==old.drift||next.steer!==old.steer){pending.current.push({tick:s.tick,...next});lastRecorded.current=next;}
      s.control={...next};step(s,seed.current);
    }
    if(practice)pending.current=[];
    if(time-lastHud.current>80){lastHud.current=time;setHud({speed:s.speed,distance:s.distance,time:Math.max(0,Math.ceil((RACE_TICKS-s.tick)/60)),rank:rank.current,phase,count,nitro:nitroMultiplier(s)-1,hit:Math.max(0,(s.hitUntil-s.tick)/60),connection:practice||Date.now()-lastGood.current<3500,hits:s.hits,pickups:s.pickups});}
  },[practice]);
  function retry(){state.current=initialState();pending.current=[];ack.current=0;releaseAll();roomRef.current={...roomRef.current,startAt:Date.now()+3000,endAt:Date.now()+63000};setReady(true);}
  return <div className="driver-outer"><div className="phone-game"><header className="driver-top"><a href="/" aria-label="返回首页">←</a><b>{practice?'自由试驾':'极速热场'}<small>{practice?'不计正式成绩':'房间 '+code+' · 第 '+roomRef.current.round+' 局'}</small></b><span className={hud.connection?'online':'offline'}>{hud.connection?'● 已连接':'● 重连中'}</span></header>
    <div className="drive-viewport"><RaceCanvas state={state} seed={seed} color={session.player.color} frame={frame}/><div className="driver-hud"><div><small>剩余时间</small><strong>{String(hud.time).padStart(2,'0')}<em>s</em></strong></div><div className="hud-center"><small>{session.player.name}</small><strong>{Math.round(hud.speed)}<em>码</em></strong></div><div><small>{practice?'已行驶':'当前排名'}</small><strong>{practice?Math.round(hud.distance):'#'+hud.rank}<em>{practice?'m':''}</em></strong></div></div>
      <div className="nitro-meter" aria-hidden="true"><i style={{width:`${Math.max(0,hud.nitro/.3)*100}%`}}/></div><div className="effect-chips">{hud.nitro>0&&<span className="nitro-chip">氮气 +{Math.round(hud.nitro*100)}%</span>}{hud.hit>0&&<span className="hit-chip">碰撞减速 {hud.hit.toFixed(1)}s</span>}</div>
      {hud.phase==='waiting'&&<div className="game-overlay waiting-overlay"><span className="eyebrow">YOU'RE ON THE GRID</span>{car(session.player.color)}<h2>{ready?'车手已就位':'欢迎入场，'+session.player.name}</h2><p>保持竖屏，双手握稳手机。<br/>开启体感后，等待主持人统一发车。</p><button className="primary" onClick={enableSensor}>{calibrated?'重新校准握姿':'开启体感并校准'}</button><p className="sensor-status">{sensor}</p><button className="secondary" onClick={()=>setReady(true)}>{ready?'已准备，等待发车':'使用方向键，我已准备'}</button><span className="overlay-room">房间号 {code}</span></div>}
      {hud.phase==='countdown'&&<div className="game-overlay countdown-overlay"><strong>{Math.max(1,hud.count)}</strong><h2>准备发车</h2><p>右下加速 · 左下漂移</p>{!calibrated&&<button className="secondary" onClick={enableSensor}>开启体感 / 校准</button>}</div>}
      {(hud.phase==='settling'||hud.phase==='finished')&&<div className="game-overlay finish-overlay"><span className="eyebrow">{practice?'PRACTICE COMPLETE':hud.phase==='finished'?'RACE COMPLETE':'FINISH LINE'}</span><h2>{practice?'试驾完成！':hud.phase==='finished'?'漂亮，完成比赛！':'冲线成功！'}</h2><div className="finish-distance">{hud.distance.toFixed(1)}<small>米</small></div><p>{practice?'氮气 '+hud.pickups+' 次 · 碰撞 '+hud.hits+' 次':hud.phase==='finished'?'最终排名 #'+hud.rank:'正在同步全场成绩，请稍候…'}</p>{practice?<button className="primary" onClick={retry}>再试一圈 →</button>:<a className="primary" href={'/?screen='+code}>查看全场成绩 ↗</a>}<a href="/" className="finish-home">返回首页</a></div>}
      <div className="drive-bottom-info"><span>{hud.distance.toFixed(0)} m</span><span>{hud.phase==='racing'&&hud.time<=10?'最后冲刺！':Math.abs(state.current.x)>1?'驶回赛道，恢复车速':'倾斜手机控制方向'}</span></div>
    </div>
    <div className="driver-controls"><div className="steer-buttons"><button aria-label="向左转向" onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);touchSteer.current=-1;}} onPointerUp={()=>touchSteer.current=0} onPointerCancel={()=>touchSteer.current=0} onLostPointerCapture={()=>touchSteer.current=0}>←</button><button className="calibrate" onClick={enableSensor}>{calibrated?'体感已开启 · 点此校准':'开启体感 / 校准'}</button><button aria-label="向右转向" onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);touchSteer.current=1;}} onPointerUp={()=>touchSteer.current=0} onPointerCancel={()=>touchSteer.current=0} onLostPointerCapture={()=>touchSteer.current=0}>→</button></div><div className="main-controls"><HoldButton label="漂移" hint="按住过弯" color="blue" onHold={v=>setControl('drift',v)}/><div className="cruise-note">松手巡航<strong>30<small>码</small></strong></div><HoldButton label="加速" hint="按住提速" color="yellow" onHold={v=>setControl('throttle',v)}/></div></div>
    {error&&!hud.connection&&<div className="network-toast" role="status">网络较慢，正在自动重连；驾驶操作会继续记录。</div>}</div><p className="desktop-help">电脑试玩：← → 转向 · ↑ / 空格加速 · Shift 漂移</p></div>;
}
export default function GameApp(){
  const[route,setRoute]=useState<Record<string,string>|null>(null),[session,setSession]=useState<Session|null>(null),[bootstrap,setBootstrap]=useState<any>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const query=Object.fromEntries(new URLSearchParams(location.search));setRoute(query);
    if(query.room){const saved=jsonStore.get('race-player-'+query.room);if(saved){setLoading(true);api({action:'resume',code:query.room,token:saved.token}).then(d=>{setBootstrap(d);setSession(saved);}).catch(e=>{setError(e.message);if(e.status===401)jsonStore.remove('race-player-'+query.room);}).finally(()=>setLoading(false));}}
  },[]);
  const joined=(code:string,s:Session,d:any)=>{history.replaceState(null,'','/?room='+code);setRoute({room:code});setBootstrap(d);setSession(s);};
  if(!route)return <div className="boot"><Brand/><p>赛道准备中…</p></div>;
  if(route.practice)return <Driver code="practice" practice session={{token:'practice',player:{id:'practice',name:'试驾车手',color:'blue'}}} bootstrap={null}/>;
  if(route.host||route.screen)return <RoomView code={route.host||route.screen} host={!!route.host}/>;
  if(route.mode)return <RoomPicker mode={route.mode}/>;
  if(route.room){if(loading)return <div className="boot"><Brand/><p>正在找回你的赛车…</p></div>;
    if(session)return <Driver code={route.room} session={session} bootstrap={bootstrap}/>;
    return <div className="mobile-join"><Brand/><div className="join-card">{error&&<p className="error">{error}</p>}<JoinForm initialCode={route.room} onJoin={joined}/></div><a href="/?practice=1">发车前，先试一圈 ↗</a></div>;
  }
  return <Landing onJoin={joined}/>;
}
