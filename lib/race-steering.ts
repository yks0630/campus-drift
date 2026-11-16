export type SteeringSnapshot={
  mode:'sensor'|'buttons'|null;
  status:'choose'|'requesting'|'calibrating'|'ready'|'error';
  message:string;
  canPrepare:boolean;
};

export class RaceSteering {
  private state:SteeringSnapshot;
  private listeners=new Set<()=>void>();
  private attempt=0;
  private baseline:number|null=null;
  private gamma:number|null=null;
  private timer:ReturnType<typeof setTimeout>|undefined;
  constructor(restoredReady=false,reviewCalibrated=false){
    this.state=reviewCalibrated
      ?{mode:'sensor',status:'ready',message:'体感驾驶已就绪',canPrepare:true}
      :restoredReady
        ?{mode:'buttons',status:'ready',message:'当前为按键驾驶。体感需要重新开启并校准。',canPrepare:true}
        :{mode:null,status:'choose',message:'请选择驾驶方式，再点击准备。',canPrepare:false};
  }
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(state:SteeringSnapshot){this.state=state;for(const listener of this.listeners)listener();}
  private cancel(){this.attempt++;clearTimeout(this.timer);this.timer=undefined;this.baseline=null;this.gamma=null;}
  useButtons=()=>{
    this.cancel();this.update({mode:'buttons',status:'ready',message:'按键驾驶已就绪：使用下方 ← → 转向。',canPrepare:true});
  };
  async useSensor(permission:()=>Promise<string>,timeoutMs=4000){
    this.cancel();const attempt=this.attempt;
    this.update({mode:'sensor',status:'requesting',message:'正在申请体感权限…',canPrepare:false});
    try{
      const granted=await permission();if(attempt!==this.attempt)return;
      if(granted!=='granted')throw new Error('体感授权未通过，请重试或改用按键驾驶。');
      this.update({mode:'sensor',status:'calibrating',message:'请竖屏握稳手机，正在校准…',canPrepare:false});
      this.timer=setTimeout(()=>{
        if(attempt===this.attempt&&this.state.status==='calibrating')this.fail('未收到体感数据，请重试或改用按键驾驶。');
      },timeoutMs);
    }catch(e){if(attempt===this.attempt)this.fail(e instanceof Error?e.message:'体感不可用，请改用按键驾驶。');}
  }
  private fail(message:string){clearTimeout(this.timer);this.update({mode:'sensor',status:'error',message,canPrepare:false});}
  observe(gamma:number|null){
    if(this.state.mode!=='sensor'||!['calibrating','ready'].includes(this.state.status)
      ||gamma===null||!Number.isFinite(gamma)||Math.abs(gamma)>90)return;
    this.gamma=gamma;
    if(this.baseline===null){
      this.baseline=gamma;clearTimeout(this.timer);
      this.update({mode:'sensor',status:'ready',message:'体感驾驶已就绪：左右倾斜手机转向。',canPrepare:true});
    }
  }
  readSteer=()=>{
    if(this.state.mode!=='sensor'||this.state.status!=='ready'||this.gamma===null||this.baseline===null)return 0;
    const tilt=Math.max(-1,Math.min(1,(this.gamma-this.baseline)/22));
    return Math.abs(tilt)<.08?0:tilt;
  };
  dispose=()=>this.cancel();
}
