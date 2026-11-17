import {env} from 'cloudflare:workers';
import {playerRequest} from '@/lib/race-http';
export function GET(request:Request){return playerRequest(request,env.DB!);}
export function POST(request:Request){return playerRequest(request,env.DB!);}
