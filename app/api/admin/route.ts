import {env} from 'cloudflare:workers';
import {adminRequest} from '@/lib/race-http';
export function GET(request:Request){return adminRequest(request,env.DB!,env.RACE_ADMIN_PASSWORD);}
export function POST(request:Request){return adminRequest(request,env.DB!,env.RACE_ADMIN_PASSWORD);}
