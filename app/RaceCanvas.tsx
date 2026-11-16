'use client';
import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import {objectSize,speedZoom,roadCenterOffset,trackBounds,trackObject,nitroMultiplier,clamp,TRACK_CONFIG,type RaceState} from '@/lib/race-sim';
type Props={state:MutableRefObject<RaceState>;seed:MutableRefObject<number>;color:string;frame:(time:number)=>void;className?:string};
const files=['road_asphalt01.png','land_grass04.png','tree_small.png','tree_large.png','barrier_red_race.png','skidmark_short_1.png','../gameplay/nitro-n2o.png','../gameplay/fire11.png','../effects/smoke_01.png','../effects/spark_01.png',...['blue','red','green','yellow','black'].map(c=>'car_'+c+'_1.png')];
let assetPromise:Promise<Record<string,HTMLImageElement>>|null=null;
function assets(){
  if(!assetPromise)assetPromise=Promise.all(files.map(name=>new Promise<[string,HTMLImageElement]>((resolve,reject)=>{
    const image=new Image();image.onload=()=>resolve([name,image]);image.onerror=()=>reject(new Error('素材加载失败'));image.src='/assets/racing/'+name;
  }))).then(Object.fromEntries).catch(e=>{assetPromise=null;throw e;});
  return assetPromise;
}
export default function RaceCanvas({state,seed,color,frame,className=''}:Props){
  const canvas=useRef<HTMLCanvasElement>(null),callback=useRef(frame),colorRef=useRef(color);
  callback.current=frame;colorRef.current=color;
  const[error,setError]=useState('');
  useEffect(()=>{
    let stopped=false,id=0,images:Record<string,HTMLImageElement>;
    let lastDistance=0,groundOffset=0;
    let lastMarkDistance=-10;
    const marks:{distance:number;x:number;angle:number}[]=[];
    const el=canvas.current!,ctx=el.getContext('2d')!;
    const resize=()=>{const ratio=Math.min(devicePixelRatio||1,2);const width=Math.round(el.clientWidth*ratio),height=Math.round(el.clientHeight*ratio);if(el.width===width&&el.height===height)return;el.width=width;el.height=height;ctx.setTransform(ratio,0,0,ratio,0,0);};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();
    function draw(time:number){
      if(stopped)return;
      callback.current(time);
      const s=state.current,w=el.clientWidth,h=el.clientHeight,roadW=w*TRACK_CONFIG.roadWidthRatio,carY=h*.76;
      // Zoom with actual speed: faster road flow and less advance warning at high speed.
      // Keep the same world coordinates and collision rules for every camera scale.
      if(s.distance<lastDistance){groundOffset=0;marks.length=0;lastMarkDistance=-10;}
      const scale=w/TRACK_CONFIG.metresPerViewWidth*(s.viewZoom??speedZoom(s.speed));
      groundOffset+=Math.max(0,s.distance-lastDistance)*scale;lastDistance=s.distance;
      ctx.clearRect(0,0,w,h);
      const tile=w/3,offset=groundOffset%tile;
      for(let x=0;x<w;x+=tile)for(let y=-tile;y<h+tile;y+=tile)ctx.drawImage(images['land_grass04.png'],x,y+offset,tile+1,tile+1);
      // Keep the far side of an S bend visible in a narrow portrait viewport.
      const center=(ahead:number)=>w*.5+roadCenterOffset(s.distance,ahead)*w;
      const road=images['road_asphalt01.png'];
      // Bend an existing road texture in thin strips; all road artwork comes from the pack.
      for(let y=0;y<h;y+=3){const ahead=(carY-y)/scale,cx=center(ahead),row=((s.distance+ahead)*3%road.height+road.height)%road.height;
        ctx.drawImage(road,0,Math.floor(row),road.width,1,cx-roadW/2,y,roadW,3.5);}
      for(let i=Math.max(0,Math.floor((s.distance-50)/21));i<(s.distance+h/scale)/21+2;i++){
        const ahead=i*21-s.distance,y=carY-ahead*scale;
        if(y<-80||y>h+80)continue;
        const cx=center(ahead),side=i%2?-1:1,size=w*(i%3===0?.15:.105);
        ctx.drawImage(images[i%3===0?'tree_large.png':'tree_small.png'],cx+side*(roadW*.67)-size/2,y-size/2,size,size);
      }
      const sliding=s.control.drift||Math.abs(s.driftAngle??0)>.24;
      if(sliding&&s.speed>15&&s.tick<3600&&s.distance-lastMarkDistance>1.5){
        marks.push({distance:s.distance-2,x:s.x,angle:s.driftAngle??0});lastMarkDistance=s.distance;
      }
      while(marks.length&&(s.distance-marks[0].distance>45||marks.length>64))marks.shift();
      for(const mark of marks){
        const ahead=mark.distance-s.distance,y=carY-ahead*scale;
        if(y>h+80)continue;
        ctx.save();ctx.globalAlpha=.32*clamp(1-(s.distance-mark.distance)/45,0,1);
        ctx.translate(center(ahead)+mark.x/TRACK_CONFIG.halfWidth*roadW*.40,y);ctx.rotate(mark.angle);
        ctx.drawImage(images['skidmark_short_1.png'],-w*.056,-w*.055,w*.112,w*.11);ctx.restore();
      }
      const start=Math.max(0,Math.floor((s.distance-60-TRACK_CONFIG.objectStart)/TRACK_CONFIG.objectSpacing));
      for(let i=start;i<start+15;i++){
        const obj=trackObject(i,seed.current),ahead=obj.distance-s.distance,y=carY-ahead*scale;
        if(y<-70||y>h+60)continue;
        if(obj.index<s.nextObject)continue;
        const x=center(ahead)+obj.x/TRACK_CONFIG.halfWidth*roadW*.40,size=w*.12,footprint=objectSize(obj.type),objectW=w*footprint.width,objectH=w*footprint.height;
        if(obj.type==='nitro'){
          ctx.save();ctx.shadowColor='#75d9ff';ctx.shadowBlur=13;
          ctx.drawImage(images['../gameplay/nitro-n2o.png'],x-objectW/2,y-objectH/2,objectW,objectH);ctx.restore();
        }else ctx.drawImage(images['barrier_red_race.png'],x-objectW/2,y-objectH/2,objectW,objectH);
        ctx.save();ctx.font='bold '+Math.max(10,w*.029)+'px sans-serif';ctx.textAlign='center';
        ctx.lineWidth=3;ctx.strokeStyle='#173443';ctx.fillStyle=obj.type==='nitro'?'#c5f5ff':'#fff1ca';
        const label=obj.type==='nitro'?'氮气':'避让',labelY=y+size*(obj.type==='nitro'?.77:.60);
        ctx.strokeText(label,x,labelY);ctx.fillText(label,x,labelY);ctx.restore();
      }
      const angle=s.driftAngle??s.control.steer*.12,bounds=trackBounds(s.distance,angle);
      const x=w*.5+clamp(s.x,bounds.min,bounds.max)/TRACK_CONFIG.halfWidth*roadW*.40,carW=w*TRACK_CONFIG.carWidthRatio,carH=carW*TRACK_CONFIG.carLengthRatio;
      ctx.save();ctx.translate(x,carY);ctx.rotate(angle);
      if(nitroMultiplier(s)>1&&s.tick<3600){
        const strength=(nitroMultiplier(s)-1)/.3,pulse=.94+Math.sin(time/42)*.09;
        const length=carH*(.22+.65*strength)*pulse,width=carW*.37;
        ctx.save();ctx.globalAlpha=.45+.55*strength;ctx.shadowColor='#7de9ff';ctx.shadowBlur=12;
        for(const side of [-1,1])ctx.drawImage(images['../gameplay/fire11.png'],side*carW*.24-width/2,carH*.37,width,length*(side<0?1:.92));
        ctx.restore();
      }
      if(sliding&&s.speed>20&&s.tick<3600){
        ctx.save();ctx.globalAlpha=.42;ctx.globalCompositeOperation='screen';const size=carW*1.8;
        for(const side of [-1,1])ctx.drawImage(images['../effects/smoke_01.png'],side*carW*.32-size/2,carH*.28+Math.sin(time/110+side)*carW*.08,size,size);
        ctx.restore();
      }
      if(Math.max(s.hitUntil,s.wallUntil??0)-s.tick>165){ctx.save();ctx.globalAlpha=.7;ctx.globalCompositeOperation='screen';ctx.drawImage(images['../effects/spark_01.png'],-carW*.9,-carH*.7,carW*1.8,carW*1.8);ctx.restore();}
      ctx.shadowColor=nitroMultiplier(s)>1?'#83dfff':'#11222b';ctx.shadowBlur=nitroMultiplier(s)>1?14:7;
      ctx.globalAlpha=s.tick<Math.max(s.hitUntil,s.wallUntil??0)&&Math.floor(time/120)%2?.63:1;
      ctx.drawImage(images['car_'+colorRef.current+'_1.png']||images['car_blue_1.png'],-carW/2,-carH/2,carW,carH);ctx.restore();
      id=requestAnimationFrame(draw);
    }
    assets().then(result=>{if(stopped)return;images=result;id=requestAnimationFrame(draw);}).catch(()=>setError('赛道素材加载失败，请检查网络后刷新。'));
    return()=>{stopped=true;cancelAnimationFrame(id);observer.disconnect();};
  },[state,seed]);
  return <div className={'canvas-wrap '+className}><canvas ref={canvas} aria-label="俯视角赛车赛道"/>{error&&<p className="asset-error">{error}</p>}</div>;
}
