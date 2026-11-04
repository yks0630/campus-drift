import {env} from 'cloudflare:workers';
import {gameAction,GameError,roomSnapshot} from '@/lib/race-service';
const headers={'Cache-Control':'no-store'};
export async function GET(request:Request){
  try{return Response.json(await roomSnapshot(env.DB!,new URL(request.url).searchParams.get('code')||''),{headers});}
  catch(e){return fail(e);}
}
export async function POST(request:Request){
  try{
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)throw new GameError('请求来源不正确。',403);
    if(Number(request.headers.get('content-length'))>150000)throw new GameError('操作数据过大。',413);
    const text=await request.text();if(text.length>150000)throw new GameError('操作数据过大。',413);
    const body=JSON.parse(text);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new GameError('请求格式不正确。');
    return Response.json(await gameAction(env.DB!,body),{headers});
  }catch(e){return fail(e);}
}
function fail(e:unknown){
  if(e instanceof SyntaxError)return Response.json({error:'请求格式不正确。'},{status:400,headers});
  if(e instanceof GameError)return Response.json({error:e.message},{status:e.status,headers});
  console.error('race-api',e instanceof Error?e.message:'unknown');
  return Response.json({error:'比赛服务暂时不可用，请稍后重试。'},{status:503,headers});
}
