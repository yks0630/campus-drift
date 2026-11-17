import {GameError} from './race-service.ts';

const COOKIE='race_admin';
const SESSION_MS=8*60*60*1000;
export async function digest(value:string){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function cookieToken(request:Request){
  return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
}
function cookie(request:Request,value:string,age:number){
  const url=new URL(request.url);
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${url.protocol==='https:'?'; Secure':''}`;
}
function configured(password:unknown):asserts password is string{
  if(typeof password!=='string'||password.length<12)throw new GameError('管理员密码尚未配置，请在服务器设置至少 12 位的 RACE_ADMIN_PASSWORD。',503);
}
export async function requireAdmin(db:D1Database,request:Request,password:unknown,now=Date.now()){
  configured(password);
  const token=cookieToken(request);
  if(!/^[a-f0-9]{64}$/.test(token))throw new GameError('请先登录管理后台。',401);
  const session=await db.prepare('SELECT token_hash FROM race_admin_sessions WHERE token_hash=? AND password_hash=? AND expires_at>?')
    .bind(await digest(token),await digest(password+'\0'+token),now).first();
  if(!session)throw new GameError('后台登录已失效，请重新登录。',401);
}
export async function loginAdmin(db:D1Database,request:Request,password:unknown,input:unknown,now=Date.now()){
  configured(password);
  const key=await digest(request.headers.get('cf-connecting-ip')||'local-admin-login');
  // D1 counts every attempt atomically, including simultaneous requests.
  await db.prepare(`INSERT INTO race_admin_attempts(client_hash,started_at,attempts) VALUES(?,?,1)
    ON CONFLICT(client_hash) DO UPDATE SET
    attempts=CASE WHEN started_at<=? THEN 1 ELSE attempts+1 END,
    started_at=CASE WHEN started_at<=? THEN excluded.started_at ELSE started_at END`)
    .bind(key,now,now-900000,now-900000).run();
  const attempt=await db.prepare('SELECT attempts FROM race_admin_attempts WHERE client_hash=?').bind(key).first<{attempts:number}>();
  if(!attempt||attempt.attempts>5)throw new GameError('登录尝试过多，请 15 分钟后再试。',429);
  // Compare fixed-length hashes without an early exit on a matching prefix.
  const expected=await digest(password),actual=await digest(typeof input==='string'?input:'');
  let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^actual.charCodeAt(i);
  if(difference)throw new GameError('管理员密码不正确。',401);
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  await db.batch([
    db.prepare('DELETE FROM race_admin_sessions WHERE expires_at<=?').bind(now),
    db.prepare('INSERT INTO race_admin_sessions(token_hash,password_hash,expires_at) VALUES(?,?,?)').bind(await digest(token),await digest(password+'\0'+token),now+SESSION_MS),
    db.prepare('DELETE FROM race_admin_attempts WHERE client_hash=? OR started_at<=?').bind(key,now-900000),
  ]);
  return cookie(request,token,SESSION_MS/1000);
}
export async function logoutAdmin(db:D1Database,request:Request){
  await db.prepare('DELETE FROM race_admin_sessions WHERE token_hash=?').bind(await digest(cookieToken(request))).run();
  return cookie(request,'',0);
}
