export async function requestAdmin(body?:Record<string,unknown>){
  const response=await fetch('/api/admin',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)}:{cache:'no-store',signal:AbortSignal.timeout(10000)});
  const data:any=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(new Error(data?.error||'后台连接暂时不可用，请重试。'),{status:response.status});
  return data;
}
