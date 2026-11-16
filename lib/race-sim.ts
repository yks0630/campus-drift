export const FPS = 60;
export const RACE_TICKS = 3600;
export const COLORS = ['blue', 'red', 'green', 'yellow', 'black'] as const;
// Shared by physics, authoritative replay, and the road renderer.
export const TRACK_CONFIG = {
  halfWidth:1.25,
  roadWidthRatio:.84,
  // road_asphalt01.png: asphalt is x=20..108 in the 128px texture.
  asphaltWidthRatio:88/128,
  objectStart:55,
  objectSpacing:44,
  carWidthRatio:.102,
  carLengthRatio:1.84,
  metresPerViewWidth:105,
} as const;
export type Control = { throttle: boolean; drift: boolean; steer: number };
export type InputEvent = Control & { tick: number };
export type RaceState = {
  tick: number; base: number; speed: number; distance: number; x: number;
  lateralVelocity?: number; driftAngle?: number; viewZoom?: number; wallUntil?: number; wallHits?: number;
  nitroUntil: number; hitUntil: number; nextObject: number;
  hits: number; pickups: number; control: Control;
};
export function initialState(): RaceState {
  return { tick:0, base:0, speed:0, distance:0, x:0, lateralVelocity:0, driftAngle:0, viewZoom:1, wallUntil:0, wallHits:0, nitroUntil:-120, hitUntil:0,
    nextObject:0, hits:0, pickups:0, control:{throttle:false,drift:false,steer:0} };
}
export const clamp = (v:number,a:number,b:number) => Math.max(a,Math.min(b,v));
export function nitroMultiplier(s:RaceState) {
  if (s.tick<s.nitroUntil) return 1.3;
  return 1+.3*clamp(1-(s.tick-s.nitroUntil)/120,0,1);
}
export function actualSpeed(s:RaceState) {
  return s.base*nitroMultiplier(s)*(s.tick<Math.max(s.hitUntil,s.wallUntil??0)?.5:1)*(s.control.drift?.92:1);
}
export function roadPosition(d:number) { return Math.sin(d/95)*.42+Math.sin(d/43)*.16; }
export function roadCurve(d:number) { return 180*(Math.cos(d/95)*.42/95+Math.cos(d/43)*.16/43); }
export function roadCenterOffset(distance:number,ahead:number){
  return Math.tanh((roadPosition(distance+ahead)-roadPosition(distance))*1.9)*.34;
}
export function trackBounds(distance:number,angle=0){
  const carWidth=TRACK_CONFIG.carWidthRatio,carLength=carWidth*TRACK_CONFIG.carLengthRatio;
  const cosine=Math.abs(Math.cos(angle)),sine=Math.abs(Math.sin(angle));
  const halfX=(carWidth*cosine+carLength*sine)/2;
  const halfY=(carWidth*sine+carLength*cosine)/2;
  const roadHalf=TRACK_CONFIG.roadWidthRatio*TRACK_CONFIG.asphaltWidthRatio/2,unit=TRACK_CONFIG.roadWidthRatio*.4/TRACK_CONFIG.halfWidth;
  let min:number=-TRACK_CONFIG.halfWidth,max:number=TRACK_CONFIG.halfWidth;
  // Bound the entire rotated body over the road beneath it, not just its centre.
  // Use the widest (low-speed) view, so every supported camera zoom stays safe.
  for(let i=-3;i<=3;i++){
    const offset=roadCenterOffset(distance,i/3*halfY*TRACK_CONFIG.metresPerViewWidth);
    min=Math.max(min,(offset-roadHalf+halfX+.008)/unit);
    max=Math.min(max,(offset+roadHalf-halfX-.008)/unit);
  }
  return {min,max};
}
export function trackObject(index:number,seed:number) {
  let v=Math.imul(index+1,0x45d9f3b)^seed;
  v=Math.imul(v^(v>>>16),0x45d9f3b); v=(v^(v>>>16))>>>0;
  return {index,distance:TRACK_CONFIG.objectStart+index*TRACK_CONFIG.objectSpacing,x:[-.62,0,.62][v%3]*TRACK_CONFIG.halfWidth,
    type:index%3===1?'nitro' as const:'obstacle' as const,variant:v%2};
}
// Normalized sprite dimensions shared with the canvas, independent of viewport size.
export function objectSize(type:'nitro'|'obstacle') {
  return type==='nitro'?{width:.12,height:.12}:{width:.156,height:.0624};
}
export const speedZoom=(speed:number)=>1+.5*clamp((speed-30)/90,0,1.3);
export function objectContact(s:RaceState,obj:ReturnType<typeof trackObject>) {
  const ahead=obj.distance-s.distance,angle=s.driftAngle??0;
  const dx=roadCenterOffset(s.distance,ahead)+(obj.x-s.x)*TRACK_CONFIG.roadWidthRatio*.4/TRACK_CONFIG.halfWidth;
  const dy=-ahead*(s.viewZoom??speedZoom(s.speed))/TRACK_CONFIG.metresPerViewWidth;
  const c=Math.cos(angle),n=Math.sin(angle),ac=Math.abs(c),an=Math.abs(n);
  const a=TRACK_CONFIG.carWidthRatio/2,b=a*TRACK_CONFIG.carLengthRatio;
  const size=objectSize(obj.type),u=size.width/2,v=size.height/2;
  // Separating axes of the rotated car and the axis-aligned obstacle.
  return Math.abs(dx)<=a*ac+b*an+u && Math.abs(dy)<=a*an+b*ac+v
    && Math.abs(dx*c+dy*n)<=a+u*ac+v*an
    && Math.abs(-dx*n+dy*c)<=b+u*an+v*ac;
}
export function step(s:RaceState,seed:number) {
  if(s.tick>=RACE_TICKS) return s;
  const previous={...s};
  const target=s.control.throttle?120:30,change=(target<s.base?30:15)/FPS;
  s.base+=clamp(target-s.base,-change,change);
  const drifting=s.control.drift&&s.base>15;
  const desiredVelocity=s.control.steer*(drifting?1.65:1.05)*(.35+.65*s.base/120)
    -roadCurve(s.distance)*s.base/120*.27*(drifting?1.55:1);
  // Lower grip while drifting carries sideways momentum through a corner.
  const velocity=s.lateralVelocity??0;
  s.lateralVelocity=velocity+(desiredVelocity-velocity)*(1-Math.exp(-(drifting?2.6:9)/FPS));
  const nextX=s.x+s.lateralVelocity/FPS;
  const targetAngle=drifting?clamp(s.control.steer*.65+s.lateralVelocity*.25,-.85,.85)*clamp(s.base/60,0,1):s.control.steer*.12;
  const angle=s.driftAngle??0;
  s.driftAngle=angle+(targetAngle-angle)*(1-Math.exp(-(drifting?5:4)/FPS));
  s.speed=actualSpeed(s);
  const zoom=s.viewZoom??speedZoom(previous.speed);
  s.viewZoom=zoom+(speedZoom(s.speed)-zoom)*(1-Math.exp(-6/FPS));
  s.distance+=s.speed/3.6/FPS;
  const bounds=trackBounds(s.distance,s.driftAngle);
  s.x=clamp(nextX,bounds.min,bounds.max);
  const wallContact=nextX<bounds.min||nextX>bounds.max;
  if(wallContact){
    if((nextX<bounds.min&&s.lateralVelocity<0)||(nextX>bounds.max&&s.lateralVelocity>0))s.lateralVelocity=0;
    // Sustained contact slows the car without counting a new hit every physics frame.
    if(s.tick>=(s.wallUntil??0)){s.wallUntil=s.tick+181;s.wallHits=(s.wallHits??0)+1;}
  }
  while(true) {
    const obj=trackObject(s.nextObject,seed);
    if(obj.distance-s.distance>24)break;
    let contact=false;
    // Sample the swept body during this fixed tick, including sideways drift.
    for(let i=0;i<=4&&!contact;i++){
      const t=i/4;
      contact=objectContact({...s,
        x:previous.x+(s.x-previous.x)*t,
        distance:previous.distance+(s.distance-previous.distance)*t,
        driftAngle:(previous.driftAngle??0)+((s.driftAngle??0)-(previous.driftAngle??0))*t,
        viewZoom:(previous.viewZoom??speedZoom(previous.speed))+((s.viewZoom??1)-(previous.viewZoom??speedZoom(previous.speed)))*t,
      },obj);
    }
    if(contact){
      if(obj.type==='nitro'){s.nitroUntil=s.tick+181;s.pickups++;}
      else{s.hitUntil=s.tick+181;s.hits++;}
      s.nextObject++;
      continue;
    }
    // Retain a missed object until it has cleared the rear of the car.
    const angle=s.driftAngle??0,size=objectSize(obj.type);
    const rear=TRACK_CONFIG.carWidthRatio*(Math.abs(Math.sin(angle))+TRACK_CONFIG.carLengthRatio*Math.abs(Math.cos(angle)))/2;
    if((s.distance-obj.distance)*(s.viewZoom??1)/TRACK_CONFIG.metresPerViewWidth>rear+size.height/2){s.nextObject++;continue;}
    break;
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
