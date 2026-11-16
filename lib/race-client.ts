import type {Control,InputEvent} from './race-sim.ts';

// A resume is safe to retry if the preview Worker restarts mid-request.
// Mutating actions (join/start/reset/etc.) must never be replayed automatically.
export async function requestGame(body:Record<string,unknown>,fetcher:typeof fetch=fetch,
  wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
  for(let attempt=0;;attempt++){
    const response=await fetcher('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(7000)});
    if(response.status===503&&body.action==='resume'&&attempt<2){
      await response.body?.cancel();await wait(200*(attempt+1));continue;
    }
    const data:any=await response.json().catch(()=>null);
    if(!response.ok)throw Object.assign(new Error(data?.error||'连接暂时不可用，请重试。'),{status:response.status});
    if(!data)throw new Error('连接响应不完整，请重试。');
    return data;
  }
}

export const releasedControl = ():Control => ({throttle:false,drift:false,steer:0});

// The first frame after reload must compare against the server's saved buttons.
export function restoredControl(saved?:Control):Control {
  return {...(saved||releasedControl())};
}

export function sampleControl(tick:number,last:Control,desired:Control) {
  const control={...desired,steer:tick%6===0?desired.steer:last.steer};
  const changed=control.throttle!==last.throttle||control.drift!==last.drift||control.steer!==last.steer;
  return {control,event:changed?{tick,...control} as InputEvent:null};
}

export type ReadinessStamp={round:number;readyVersion:number;ready:boolean};
export function acceptReadiness(current:ReadinessStamp,incoming:ReadinessStamp):ReadinessStamp {
  if(incoming.round<current.round||(incoming.round===current.round&&incoming.readyVersion<current.readyVersion))return current;
  return incoming;
}
