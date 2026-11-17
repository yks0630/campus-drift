'use client';
import {useEffect,useState} from 'react';
import {RoomView} from '../GameApp';
import {requestAdmin} from '@/lib/race-admin-client';

type AdminRoom={code:string;round:number;start_at:number|null;created_at:number};
export default function AdminApp(){
  const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const[rooms,setRooms]=useState<AdminRoom[]>([]),[code,setCode]=useState(''),[error,setError]=useState('');
  function selectRoom(value:string){setCode(value);history.replaceState(null,'',value?'/admin?room='+value:'/admin');}
  async function refresh(){const data=await requestAdmin();setRooms(data.rooms);}
  useEffect(()=>{
    setCode((new URLSearchParams(location.search).get('room')||'').replace(/\D/g,'').slice(0,6));
    refresh().catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[]);
  async function create(){
    setBusy(true);setError('');
    try{const data=await requestAdmin({action:'create'});selectRoom(data.room.code);await refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  if(loading)return <div className="boot"><p>正在读取比赛房间…</p></div>;
  return <><nav className="admin-nav" aria-label="管理后台"><strong>管理后台</strong><label>比赛房间<select aria-label="选择管理房间" value={code} onChange={e=>selectRoom(e.target.value)}><option value="">选择房间</option>{rooms.map(r=><option key={r.code} value={r.code}>{r.code} · 第 {r.round} 局</option>)}</select></label><button className="primary" disabled={busy} onClick={create}>创建房间</button></nav>{error&&<p className="error admin-message" role="alert">{error}</p>}{code?<RoomView key={code} code={code} host/>:<div className="utility-page"><section className="utility-card"><h1>比赛管理</h1><p>{rooms.length?'选择已有房间，或创建一场新的比赛。':'还没有比赛房间，创建后即可打开大屏让玩家扫码。'}</p><button className="primary wide" disabled={busy} onClick={create}>创建比赛房间 →</button></section></div>}<footer className="artist-credit"><a href="/credits">素材授权</a></footer></>;
}
