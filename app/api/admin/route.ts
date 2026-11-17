import {env} from 'cloudflare:workers';
import {adminRequest} from '@/lib/race-http';
export function GET(request:Request){return adminRequest(request,env.DB!);}
export function POST(request:Request){return adminRequest(request,env.DB!);}
