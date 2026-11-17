'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {RoomView} from '../GameApp';
import {requestAdmin} from '@/lib/race-admin-client';

type AdminRoom={code:string;round:number;start_at:number|null;created_at:number};
export default function AdminApp(){
  const[authenticated,setAuthenticated]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const[rooms,setRooms]=useState<AdminRoom[]>([]),[code,setCode]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[configured,setConfigured]=useState(true);
  function selectRoom(value:string){setCode(value);history.replaceState(null,'',value?'/admin?room='+value:'/admin');}
  function expired(){setAuthenticated(false);setPassword('');setError('后台登录已失效，请重新登录。');}
  async function refresh(){
    const data=await requestAdmin();setRooms(data.rooms);setAuthenticated(true);setConfigured(true);
    return data;
  }
  useEffect(()=>{
    setCode((new URLSearchParams(location.search).get('room')||'').replace(/\D/g,'').slice(0,6));
    refresh().catch(e=>{if(e.status!==401)setError(e.message);if(e.status===503)setConfigured(false);}).finally(()=>setLoading(false));
  },[]);
  async function login(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');
    try{await requestAdmin({action:'login',password});setPassword('');await refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function create(){
    setBusy(true);setError('');
    try{const data=await requestAdmin({action:'create'});selectRoom(data.room.code);await refresh();}
    catch(e){if((e as {status?:number}).status===401)expired();else setError((e as Error).message);}finally{setBusy(false);}
  }
  async function logout(){
    setBusy(true);setError('');
    try{await requestAdmin({action:'logout'});setAuthenticated(false);setPassword('');selectRoom('');}
    catch(e){if((e as {status?:number}).status===401)expired();else setError((e as Error).message);}finally{setBusy(false);}
  }
  if(loading)return <div className="boot"><p>正在验证后台身份…</p></div>;
  if(!authenticated)return <div className="utility-page"><header><span className="brand">极速热场 · 管理后台</span></header><section className="utility-card"><span className="eyebrow">ADMIN LOGIN</span><h1>管理员登录</h1><p>登录后管理比赛房间与主持操作。</p><form onSubmit={login}><label>管理员密码<input aria-label="管理员密码" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={256} disabled={!configured||busy}/></label><button className="primary wide" disabled={busy||!configured}>{busy?'正在登录…':'登录管理后台 →'}</button></form>{error&&<p className="error" role="alert">{error}</p>}</section><footer className="artist-credit"><a href="/credits">素材授权</a></footer></div>;
  return <><nav className="admin-nav" aria-label="管理后台"><strong>管理后台</strong><label>比赛房间<select aria-label="选择管理房间" value={code} onChange={e=>selectRoom(e.target.value)}><option value="">选择房间</option>{rooms.map(r=><option key={r.code} value={r.code}>{r.code} · 第 {r.round} 局</option>)}</select></label><button className="primary" disabled={busy} onClick={create}>创建房间</button><button className="secondary" disabled={busy} onClick={logout}>退出登录</button></nav>{error&&<p className="error admin-message" role="alert">{error}</p>}{code?<RoomView key={code} code={code} host onUnauthorized={expired}/>:<div className="utility-page"><section className="utility-card"><h1>比赛管理</h1><p>{rooms.length?'选择已有房间，或创建一场新的比赛。':'还没有比赛房间，创建后即可打开大屏让玩家扫码。'}</p><button className="primary wide" disabled={busy} onClick={create}>创建比赛房间 →</button></section></div>}</>;
}
