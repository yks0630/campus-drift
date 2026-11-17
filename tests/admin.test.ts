import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './d1.ts';
import {adminRequest,playerRequest} from '../lib/race-http.ts';
import {gameAction} from '../lib/race-service.ts';
import {loginAdmin,requireAdmin,digest} from '../lib/race-admin.ts';

const password='test-only-admin-password-2026';
function request(path:string,body?:Record<string,unknown>,cookie='',origin='http://localhost'){
  return new Request('http://localhost'+path,body?{method:'POST',headers:{'Content-Type':'application/json',origin,cookie},body:JSON.stringify(body)}:{headers:{cookie}});
}
async function loggedIn(db:D1Database){
  const response=await adminRequest(request('/api/admin',{action:'login',password}),db,password);
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie')!;
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Path=\/api\/admin/);
  return cookie.split(';')[0];
}
test('player endpoint rejects every host action, old host tokens and forged admin flags',async()=>{
  const db=database();
  for(const action of ['create','start','reset','remove']){
    const response=await playerRequest(request('/api/game',{action,admin:true,hostToken:'old-host-token',code:'123456'}),db);
    assert.equal(response.status,403);
  }
  assert.equal((await db.prepare('SELECT count(*) AS n FROM race_rooms').first<{n:number}>())!.n,0);
  const legacy:any=await gameAction(db,{action:'create'});
  assert.equal((await playerRequest(request('/api/game',{action:'reset',code:legacy.room.code,hostToken:legacy.hostToken,access:{admin:true}}),db)).status,403);
});
test('admin operations fail closed without config, login, or with forged and expired sessions',async()=>{
  const db=database();
  for(const body of [undefined,{action:'create'},{action:'start',admin:true}]){
    assert.equal((await adminRequest(request('/api/admin',body),db,password)).status,401);
    assert.equal((await adminRequest(request('/api/admin',body),db,undefined)).status,503);
  }
  assert.equal((await adminRequest(request('/api/admin',{action:'create'},'race_admin='+'a'.repeat(64)),db,password)).status,401);
  const cookie=await loggedIn(db);
  await db.prepare('UPDATE race_admin_sessions SET expires_at=0').run();
  assert.equal((await adminRequest(request('/api/admin',{action:'create'},cookie),db,password)).status,401);
});
test('authenticated admin controls a room; players can join but cannot use its real old host hash',async()=>{
  const db=database(),cookie=await loggedIn(db);
  const created=await adminRequest(request('/api/admin',{action:'create'},cookie),db,password),data:any=await created.json();
  assert.equal(created.status,200);assert.equal(data.hostToken,undefined);
  const code=data.room.code;
  const joined=await playerRequest(request('/api/game',{action:'join',code,name:'参赛车手'}),db);
  const player:any=await joined.json();assert.equal(joined.status,200);
  assert.equal((await playerRequest(request('/api/game',{action:'ready',code,token:player.token,round:1,readyVersion:0,ready:true}),db)).status,200);
  const unwanted:any=await (await playerRequest(request('/api/game',{action:'join',code,name:'移除测试'}),db)).json();
  assert.equal((await adminRequest(request('/api/admin',{action:'remove',code,playerId:unwanted.player.id},cookie),db,password)).status,200);
  const started=await adminRequest(request('/api/admin',{action:'start',code},cookie),db,password);
  assert.equal(started.status,200);
  assert.equal((await playerRequest(request('/api/game',{action:'reset',code,admin:true},cookie),db)).status,403);
  const listed:any=await (await adminRequest(request('/api/admin',undefined,cookie),db,password)).json();
  assert.equal(listed.rooms[0].code,code);assert.equal(listed.rooms[0].host_hash,undefined);
  await db.prepare('UPDATE race_rooms SET start_at=? WHERE code=?').bind(Date.now()-66000,code).run();
  const reset=await adminRequest(request('/api/admin',{action:'reset',code},cookie),db,password);
  assert.equal(reset.status,200);assert.equal((await reset.json() as any).room.round,2);
});
test('logout revokes the server session; password changes invalidate saved cookies',async()=>{
  const db=database(),cookie=await loggedIn(db);
  assert.equal((await adminRequest(request('/api/admin',undefined,cookie),db,password+'changed')).status,401);
  assert.equal((await adminRequest(request('/api/admin',{action:'logout'},cookie),db,password)).status,200);
  assert.equal((await adminRequest(request('/api/admin',undefined,cookie),db,password)).status,401);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM race_admin_sessions').first<{n:number}>())!.n,0);
});
test('cross-origin admin and player writes are rejected without state changes',async()=>{
  const db=database(),cookie=await loggedIn(db);
  assert.equal((await adminRequest(request('/api/admin',{action:'create'},cookie,'https://untrusted.example'),db,password)).status,403);
  assert.equal((await playerRequest(request('/api/game',{action:'join',code:'123456',name:'x'},'','https://untrusted.example'),db)).status,403);
});
test('login limits wrong-password attempts, recovers after fifteen minutes, and stores only hashes',async()=>{
  const db=database(),req=request('/api/admin'),now=1000000;
  for(let i=0;i<5;i++)await assert.rejects(loginAdmin(db,req,password,'wrong',now),{status:401});
  await assert.rejects(loginAdmin(db,req,password,password,now),{status:429});
  const cookie=await loginAdmin(db,req,password,password,now+900001),token=cookie.split(';')[0].split('=')[1];
  const session=await db.prepare('SELECT * FROM race_admin_sessions').first<{token_hash:string;password_hash:string}>();
  assert.equal(session!.token_hash,await digest(token));assert.notEqual(session!.token_hash,token);
  assert.equal(session!.password_hash,await digest(password+'\0'+token));
  await requireAdmin(db,request('/api/admin',undefined,cookie.split(';')[0]),password,now+900002);
  await assert.rejects(requireAdmin(db,request('/api/admin',undefined,cookie.split(';')[0]),password,now+900001+8*60*60*1000),{status:401});
  const secure=await loginAdmin(db,new Request('https://race.example/api/admin'),password,password,now+900003);
  assert.match(secure,/; Secure/);
});
