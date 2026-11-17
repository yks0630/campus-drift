import {gameAction,GameError,roomSnapshot,roundResult} from './race-service.ts';
import {loginAdmin,logoutAdmin,requireAdmin} from './race-admin.ts';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const hostActions=new Set(['create','start','reset','remove']);
const playerActions=new Set(['join','resume','ready','leave','input']);
async function bodyOf(request:Request){
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)throw new GameError('请求来源不正确。',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new GameError('请求格式不正确。',415);
  if(Number(request.headers.get('content-length'))>150000)throw new GameError('操作数据过大。',413);
  const text=await request.text();if(text.length>150000)throw new GameError('操作数据过大。',413);
  const body=JSON.parse(text);
  if(!body||typeof body!=='object'||Array.isArray(body))throw new GameError('请求格式不正确。');
  return body as Record<string,unknown>;
}
function fail(e:unknown){
  if(e instanceof SyntaxError)return Response.json({error:'请求格式不正确。'},{status:400,headers});
  if(e instanceof GameError)return Response.json({error:e.message},{status:e.status,headers});
  console.error('race-api',e instanceof Error?e.message:'unknown');
  return Response.json({error:'比赛服务暂时不可用，请稍后重试。'},{status:503,headers});
}
export async function playerRequest(request:Request,db:D1Database){
  try{
    if(request.method==='GET'){
      const query=new URL(request.url).searchParams,code=query.get('code')||'';
      return Response.json(query.has('round')?await roundResult(db,code,Number(query.get('round'))):await roomSnapshot(db,code),{headers});
    }
    const body=await bodyOf(request);
    if(!playerActions.has(String(body.action)))throw new GameError('玩家接口不允许主持操作，请登录管理后台。',403);
    return Response.json(await gameAction(db,body),{headers});
  }catch(e){return fail(e);}
}
export async function adminRequest(request:Request,db:D1Database,password:unknown){
  try{
    if(request.method==='GET'){
      await requireAdmin(db,request,password);
      const rooms=await db.prepare(`SELECT code,round,start_at,created_at FROM race_rooms ORDER BY created_at DESC LIMIT 100`).all();
      return Response.json({authenticated:true,rooms:rooms.results},{headers});
    }
    const body=await bodyOf(request);
    if(body.action==='login')return Response.json({authenticated:true},{headers:{...headers,'Set-Cookie':await loginAdmin(db,request,password,body.password)}});
    await requireAdmin(db,request,password);
    if(body.action==='logout')return Response.json({authenticated:false},{headers:{...headers,'Set-Cookie':await logoutAdmin(db,request)}});
    if(!hostActions.has(String(body.action)))throw new GameError('不支持的后台操作。');
    // This trusted flag is supplied by the server, never read from the JSON body.
    const result=await gameAction(db,body,Date.now(),{admin:true});
    const {hostToken:discard,...safe}=result as Record<string,unknown>;
    return Response.json(safe,{headers});
  }catch(e){return fail(e);}
}
