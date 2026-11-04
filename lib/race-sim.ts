export const FPS = 60;
export const RACE_TICKS = 3600;
export const COLORS = ['blue', 'red', 'green', 'yellow', 'black'] as const;
export type Control = { throttle: boolean; drift: boolean; steer: number };
export type InputEvent = Control & { tick: number };
export type RaceState = {
  tick: number; base: number; speed: number; distance: number; x: number;
  nitroUntil: number; hitUntil: number; nextObject: number;
  hits: number; pickups: number; control: Control;
};
export function initialState(): RaceState {
  return { tick:0, base:0, speed:0, distance:0, x:0, nitroUntil:-120, hitUntil:0,
    nextObject:0, hits:0, pickups:0, control:{throttle:false,drift:false,steer:0} };
}
export const clamp = (v:number,a:number,b:number) => Math.max(a,Math.min(b,v));
export function nitroMultiplier(s:RaceState) {
  if (s.tick<s.nitroUntil) return 1.3;
  return 1+.3*clamp(1-(s.tick-s.nitroUntil)/120,0,1);
}
export function actualSpeed(s:RaceState) {
  return s.base*nitroMultiplier(s)*(s.tick<s.hitUntil?.5:1)
    *(s.control.drift?.92:1)*(Math.abs(s.x)>1?.65:1);
}
export function roadPosition(d:number) { return Math.sin(d/110)*.30+Math.sin(d/47)*.12; }
export function roadCurve(d:number) { return Math.cos(d/110)*.55+Math.cos(d/47)*.30; }
export function trackObject(index:number,seed:number) {
  let v=Math.imul(index+1,0x45d9f3b)^seed;
  v=Math.imul(v^(v>>>16),0x45d9f3b); v=(v^(v>>>16))>>>0;
  return {index,distance:38+index*29,x:[-.62,0,.62][v%3],
    type:index%3===1?'nitro' as const:'obstacle' as const,variant:v%2};
}
export function step(s:RaceState,seed:number) {
  if(s.tick>=RACE_TICKS) return s;
  const target=s.control.throttle?120:30,change=(target<s.base?30:15)/FPS;
  s.base+=clamp(target-s.base,-change,change);
  s.x=clamp(s.x+(s.control.steer*(s.control.drift?1.65:1.05)*(.35+.65*s.base/120)
    -roadCurve(s.distance)*s.base/120*.27)/FPS,-1.28,1.28);
  s.speed=actualSpeed(s); s.distance+=s.speed/3.6/FPS;
  while(trackObject(s.nextObject,seed).distance<=s.distance) {
    const obj=trackObject(s.nextObject++,seed);
    if(Math.abs(s.x-obj.x)<.26) {
      if(obj.type==='nitro') {s.nitroUntil=s.tick+181;s.pickups++;}
      else {s.hitUntil=s.tick+181;s.hits++;}
    }
  }
  s.tick++;s.speed=actualSpeed(s);return s;
}
export function advance(s:RaceState,target:number,events:InputEvent[],seed:number) {
  let at=0;target=Math.min(RACE_TICKS,target);
  while(s.tick<target) {
    while(at<events.length&&events[at].tick<=s.tick) {
      const e=events[at++];s.control={throttle:e.throttle,drift:e.drift,steer:clamp(e.steer,-1,1)};
    }
    step(s,seed);
  }
  return s;
}
