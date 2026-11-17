import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './d1.ts';
import {adminRequest,playerRequest} from '../lib/race-http.ts';
import {gameAction} from '../lib/race-service.ts';

function request(path:string,body?:Record<string,unknown>,origin='http://localhost'){
  return new Request('http://localhost'+path,body?{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)}:{});
}
test('admin opens and creates a room without password configuration or cookies',async()=>{
  const db=database();
  const initial=await adminRequest(request('/api/admin'),db);
  assert.equal(initial.status,200);assert.deepEqual(await initial.json(),{rooms:[]});
  const created=await adminRequest(request('/api/admin',{action:'create'}),db),data:any=await created.json();
  assert.equal(created.status,200);assert.match(data.room.code,/^\d{6}$/);assert.equal(data.hostToken,undefined);
  assert.equal(created.headers.get('set-cookie'),null);
  const listed:any=await (await adminRequest(request('/api/admin'),db)).json();
  assert.equal(listed.rooms[0].code,data.room.code);assert.equal(listed.rooms[0].host_hash,undefined);
});
test('player endpoint continues rejecting host actions, old host tokens and forged admin flags',async()=>{
  const db=database();
  for(const action of ['create','start','reset','remove']){
    assert.equal((await playerRequest(request('/api/game',{action,admin:true,code:'123456'}),db)).status,403);
  }
  const legacy:any=await gameAction(db,{action:'create'});
  assert.equal((await playerRequest(request('/api/game',{action:'reset',code:legacy.room.code,hostToken:legacy.hostToken,access:{admin:true}}),db)).status,403);
});
test('passwordless backend supports create, remove, start, archive and replay without a session',async()=>{
  const db=database(),created:any=await (await adminRequest(request('/api/admin',{action:'create'}),db)).json(),code=created.room.code;
  const player:any=await (await playerRequest(request('/api/game',{action:'join',code,name:'参赛车手'}),db)).json();
  assert.equal((await playerRequest(request('/api/game',{action:'ready',code,token:player.token,round:1,readyVersion:0,ready:true}),db)).status,200);
  const unwanted:any=await (await playerRequest(request('/api/game',{action:'join',code,name:'移除测试'}),db)).json();
  assert.equal((await adminRequest(request('/api/admin',{action:'remove',code,playerId:unwanted.player.id}),db)).status,200);
  assert.equal((await adminRequest(request('/api/admin',{action:'start',code}),db)).status,200);
  await db.prepare('UPDATE race_rooms SET start_at=? WHERE code=?').bind(Date.now()-66000,code).run();
  const reset=await adminRequest(request('/api/admin',{action:'reset',code}),db);
  assert.equal(reset.status,200);assert.equal((await reset.json() as any).room.round,2);
  const saved:any=await (await playerRequest(request('/api/game?code='+code+'&round=1'),db)).json();
  assert.equal(saved.players.length,1);assert.equal(saved.players[0].name,'参赛车手');assert.equal(saved.players[0].rank,1);
});
test('cross-origin admin and player writes remain blocked',async()=>{
  const db=database();
  assert.equal((await adminRequest(request('/api/admin',{action:'create'},'https://untrusted.example'),db)).status,403);
  assert.equal((await playerRequest(request('/api/game',{action:'join',code:'123456',name:'x'},'https://untrusted.example'),db)).status,403);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM race_rooms').first<{n:number}>())!.n,0);
});
test('retired login/logout actions and malformed requests cannot mutate rooms',async()=>{
  const db=database();
  for(const action of ['login','logout','unknown'])assert.equal((await adminRequest(request('/api/admin',{action}),db)).status,400);
  assert.equal((await adminRequest(new Request('http://localhost/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:'not-json'}),db)).status,400);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM race_rooms').first<{n:number}>())!.n,0);
});
