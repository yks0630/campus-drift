'use client';
import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import {roadPosition,trackObject,nitroMultiplier,type RaceState} from '@/lib/race-sim';
type Props={state:MutableRefObject<RaceState>;seed:MutableRefObject<number>;color:string;frame:(time:number)=>void;className?:string};
const files=['road_asphalt01.png','land_grass04.png','tree_small.png','tree_large.png','cone_straight.png','tires_red.png','barrel_blue.png','skidmark_short_1.png','../effects/flame_01.png','../effects/smoke_01.png','../effects/spark_01.png',...['blue','red','green','yellow','black'].map(c=>'car_'+c+'_1.png')];
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
    const el=canvas.current!,ctx=el.getContext('2d')!;
    const resize=()=>{const rect=el.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);const width=Math.round(rect.width*ratio),height=Math.round(rect.height*ratio);if(el.width===width&&el.height===height)return;el.width=width;el.height=height;ctx.setTransform(ratio,0,0,ratio,0,0);};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();
    function draw(time:number){
      if(stopped)return;
      callback.current(time);
      const s=state.current,w=el.clientWidth,h=el.clientHeight,roadW=w*.69,carY=h*.76,scale=w/105;
      ctx.clearRect(0,0,w,h);
      const tile=w/3,offset=(s.distance*scale)%tile;
      for(let x=0;x<w;x+=tile)for(let y=-tile;y<h+tile;y+=tile)ctx.drawImage(images['land_grass04.png'],x,y+offset,tile+1,tile+1);
      const center=(ahead:number)=>w*.5+(roadPosition(s.distance+ahead)-roadPosition(s.distance))*w*.67;
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
      const start=Math.max(0,Math.floor((s.distance-60-38)/29));
      for(let i=start;i<start+15;i++){
        const obj=trackObject(i,seed.current),ahead=obj.distance-s.distance,y=carY-ahead*scale;
        if(y<-70||y>h+60)continue;
        if(obj.index<s.nextObject)continue;
        const x=center(ahead)+obj.x*roadW*.40,size=w*(obj.type==='nitro'?.09:.095);
        if(obj.type==='nitro'){
          ctx.save();ctx.shadowColor='#86f7ff';ctx.shadowBlur=18;
          ctx.drawImage(images['barrel_blue.png'],x-size/2,y-size/2,size,size*1.12);ctx.restore();
          ctx.font='bold '+Math.max(9,w*.026)+'px sans-serif';ctx.textAlign='center';ctx.fillStyle='#fff';ctx.fillText('N₂',x,y+size*.08);
        }else ctx.drawImage(images[obj.variant?'tires_red.png':'cone_straight.png'],x-size/2,y-size/2,size,size);
      }
      const x=w*.5+s.x*roadW*.40,carW=w*.102,carH=carW*1.84;
      if(s.control.drift&&s.speed>10){
        ctx.save();ctx.globalAlpha=.45;ctx.translate(x,carY+carH*.7);ctx.rotate(s.control.steer*.25);
        ctx.drawImage(images['skidmark_short_1.png'],-carW*.55,-carH*.5,carW*1.1,carH*1.3);ctx.restore();
      }
      ctx.save();ctx.translate(x,carY);ctx.rotate(s.control.steer*(s.control.drift?.36:.12));
      if(nitroMultiplier(s)>1){ctx.save();ctx.globalAlpha=.65+Math.sin(time/48)*.12;ctx.shadowColor='#c583ff';ctx.shadowBlur=16;const length=carH*(.55+Math.sin(time/40)*.08);ctx.drawImage(images['../effects/flame_01.png'],-carW*.26,carH*.30,carW*.52,length);ctx.restore();}
      if(s.control.drift&&s.speed>20){ctx.save();ctx.globalAlpha=.32;const size=carW*1.6;ctx.drawImage(images['../effects/smoke_01.png'],-size/2,carH*.28,size,size);ctx.restore();}
      if(s.hitUntil-s.tick>165){ctx.save();ctx.globalAlpha=.7;ctx.drawImage(images['../effects/spark_01.png'],-carW*.9,-carH*.7,carW*1.8,carW*1.8);ctx.restore();}
      ctx.shadowColor=nitroMultiplier(s)>1?'#c78dff':'#11222b';ctx.shadowBlur=nitroMultiplier(s)>1?22:7;
      ctx.globalAlpha=s.tick<s.hitUntil&&Math.floor(time/120)%2?.63:1;
      ctx.drawImage(images['car_'+colorRef.current+'_1.png']||images['car_blue_1.png'],-carW/2,-carH/2,carW,carH);ctx.restore();
      id=requestAnimationFrame(draw);
    }
    assets().then(result=>{if(stopped)return;images=result;id=requestAnimationFrame(draw);}).catch(()=>setError('赛道素材加载失败，请检查网络后刷新。'));
    return()=>{stopped=true;cancelAnimationFrame(id);observer.disconnect();};
  },[state,seed]);
  return <div className={'canvas-wrap '+className}><canvas ref={canvas} aria-label="俯视角赛车赛道"/>{error&&<p className="asset-error">{error}</p>}</div>;
}
