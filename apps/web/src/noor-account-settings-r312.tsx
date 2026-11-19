import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useDashboardDialog } from "./noor-dashboard-dialog.js";
import { createNoorAccountSelfServiceR312 } from "./noor-account-self-service-r312.js";
import { readBrowserPublicAuthenticationConfiguration } from "./public-authentication-environment.js";
import type { NoorPersonalCommandInput } from "./noor-personal-today-client.js";

type Profile = Readonly<{displayName:string;avatarUrl:string|null;birthDate:string|null;updatedAt:string}>;

function cropAvatar(image:HTMLImageElement,zoom:number,x:number,y:number):string {
  const canvas=document.createElement("canvas");
  canvas.width=canvas.height=192;
  const context=canvas.getContext("2d");
  if(!context)throw new Error("Avatar resize unavailable");
  const side=Math.min(image.naturalWidth,image.naturalHeight)/zoom;
  context.fillStyle="#fff";
  context.fillRect(0,0,192,192);
  context.drawImage(image,(image.naturalWidth-side)*x,(image.naturalHeight-side)*y,side,side,0,0,192,192);
  for(const quality of [.84,.68,.5,.32]){
    const data=canvas.toDataURL("image/jpeg",quality);
    if(data.length<=32768)return data;
  }
  throw new Error("Avatar exceeds size limit");
}

/** Current-password reauthentication is necessary: the Noor app cookie is
 * not a Supabase browser session. Neither the password nor provider session
 * is stored locally. Identity subject stays unchanged after an email edit. */
export function NoorAccountSettingsR312({profile=null,busy:parentBusy=false,onCommand,onReconnect,reconnecting=false,onLogout,logoutPending=false}:Readonly<{profile?:Profile|null;busy?:boolean;onCommand?:(command:NoorPersonalCommandInput)=>Promise<boolean>;onReconnect?:()=>void;reconnecting?:boolean;onLogout?:()=>void;logoutPending?:boolean}> = {}):ReactElement {
  const [currentEmail,setCurrentEmail]=useState("");
  const [currentPassword,setCurrentPassword]=useState("");
  const [nextEmail,setNextEmail]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [displayName,setDisplayName]=useState(profile?.displayName??"");
  const [avatarUrl,setAvatarUrl]=useState(profile?.avatarUrl??"");
  const [photo,setPhoto]=useState<HTMLImageElement|null>(null);
  const [cropPreview,setCropPreview]=useState("");
  const picker=useRef<HTMLInputElement>(null);
  const drag=useRef<{x:number;y:number;posX:number;posY:number}|null>(null);
  const photoViewport=useDashboardDialog(photo?".np-profile-crop-dialog":null);
  const [crop,setCrop]=useState({zoom:1,x:.5,y:.5});
  const [photoBusy,setPhotoBusy]=useState(false);
  const [birthDate,setBirthDate]=useState(profile?.birthDate??"");
  const [profileBusy,setProfileBusy]=useState(false);
  useEffect(()=>{setDisplayName(profile?.displayName??"");setAvatarUrl(profile?.avatarUrl??"");setBirthDate(profile?.birthDate??"");},[profile?.displayName,profile?.avatarUrl,profile?.birthDate]);
  const adjustPhoto=(image:HTMLImageElement,position:typeof crop)=>{
    try{setCropPreview(cropAvatar(image,position.zoom,position.x,position.y));setCrop(position);setError("");return true;}
    catch{setError("تعذّر تجهيز الصورة. جرّب صورة أخرى.");return false;}
  };
  const choosePhoto=async(file:File)=>{
    setError("");setMessage("");
    if(file.size>12*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type)){
      setError("اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 12 ميغابايت.");return;
    }
    setPhotoBusy(true);
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();image.src=url;await image.decode();
      if(adjustPhoto(image,{zoom:1,x:.5,y:.5}))setPhoto(image);
    }catch{setError("تعذّر فتح الصورة. جرّب صورة أخرى.");}
    finally{URL.revokeObjectURL(url);setPhotoBusy(false);}
  };
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(busy||parentBusy)return;
    setBusy(true);setError("");setMessage("");
    try{
      const service=createNoorAccountSelfServiceR312(readBrowserPublicAuthenticationConfiguration());
      const result=await service.requestEmailChange(currentEmail,currentPassword,nextEmail);
      if(result==="sent"){
        setMessage("تم إرسال طلب تغيير البريد. أكّد الروابط التي تصلك إلى البريد الحالي والجديد وفق إعدادات الأمان. حتى انتهاء التأكيد قد يبقى البريد القديم هو بريد الدخول.");
        setCurrentPassword("");
        setNextEmail("");
      }else setError(result==="invalid"?"تحقق من البريد الحالي وكلمة المرور والبريد الجديد.":"تعذّر إرسال طلب التغيير. تحقق من الاتصال وإعدادات التأكيد.");
    }catch{setError("خدمة تغيير البريد غير متاحة حاليًا.");}
    finally{setBusy(false);}
  };
  const persistProfile=async(nextAvatar:string,photoOnly=false)=>{
    if(!onCommand||profileBusy||parentBusy||photoBusy)return;
    const name=photoOnly?(profile?.displayName??displayName).trim():displayName.trim();
    const birth=photoOnly&&profile?profile.birthDate:birthDate||null;
    if(!name){setError("أدخل الاسم الظاهر واحفظ الملف الشخصي أولًا.");return;}
    setProfileBusy(true);setError("");setMessage("");
    try{
      const ok=await onCommand({type:"set-personal-profile",expectedUpdatedAt:profile?.updatedAt??null,displayName:name,avatarUrl:nextAvatar.trim()||null,birthDate:birth});
      if(ok){
        setAvatarUrl(nextAvatar);setMessage(photoOnly?"أُرسلت الصورة للحفظ.":"أُرسل تغيير الملف الشخصي للحفظ.");
        setPhoto(null);setCropPreview("");
      }else setError("تعذّر الحفظ. أعد المحاولة بعد تحديث البيانات.");
    }catch{setError("تعذّر الاتصال لحفظ الملف الشخصي.");}
    finally{setProfileBusy(false);}
  };
  const closePhoto=()=>{if(!profileBusy){setPhoto(null);setCropPreview("");setError("");}};
  const movePhoto=(x:number,y:number)=>{
    if(photo)adjustPhoto(photo,{...crop,x:Math.min(1,Math.max(0,x)),y:Math.min(1,Math.max(0,y))});
  };
  return <section className="np-r312-account np-r358-account" data-testid="noor-account-settings-r312" aria-label="إعدادات الحساب">
    <section className="np-r358-account-card" aria-labelledby="np-r358-profile-title">
      <header><h2 id="np-r358-profile-title">الملف الشخصي</h2></header>
      <form className="np-r358-account-grid" onSubmit={event=>{event.preventDefault();void persistProfile(avatarUrl);}}>
        <label>الاسم الظاهر<input type="text" maxLength={120} value={displayName} onChange={e=>setDisplayName(e.currentTarget.value)} disabled={profileBusy||parentBusy} required placeholder="الاسم"/></label>
        <label>تاريخ الميلاد<input type="date" value={birthDate} onChange={e=>setBirthDate(e.currentTarget.value)} disabled={profileBusy||parentBusy}/></label>
        <div className="np-r358-account-wide np-profile-photo">
          <button type="button" className="np-avatar-select" aria-label={avatarUrl?"تغيير الصورة الشخصية":"اختيار صورة شخصية من الجهاز"} disabled={profileBusy||parentBusy||photoBusy} onClick={()=>picker.current?.click()}>
            {avatarUrl?<img src={avatarUrl} alt="الصورة الشخصية" width={96} height={96}/>:<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="10" r="5"/><path d="M6 27v-2a10 8 0 0 1 20 0v2"/></svg>}
            <span>{avatarUrl?"تغيير الصورة":"اختيار من الجهاز"}</span>
          </button>
          <input ref={picker} hidden type="file" aria-label="رفع صورة شخصية" accept="image/jpeg,image/png,image/webp" disabled={profileBusy||parentBusy||photoBusy} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";if(file)void choosePhoto(file);}}/>
          {avatarUrl?<button type="button" disabled={profileBusy||parentBusy||photoBusy} onClick={()=>setAvatarUrl("")}>إزالة الصورة</button>:null}
        </div>
        <div className="np-r358-account-actions np-r358-account-wide"><button type="submit" disabled={profileBusy||parentBusy||photoBusy}>{profileBusy?"جارٍ الحفظ…":"حفظ التغييرات"}</button></div>
      </form>
    </section>
    <section className="np-r358-account-card" aria-labelledby="np-r358-security-title">
      <header><h2 id="np-r358-security-title">البريد والأمان</h2></header>
      <form className="np-r358-account-grid" onSubmit={event=>{void submit(event);}}>
        <label>البريد الحالي<input type="email" autoComplete="username" value={currentEmail} onChange={e=>setCurrentEmail(e.currentTarget.value)} disabled={busy} required placeholder="current@example.com"/></label>
        <label>كلمة المرور الحالية<input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.currentTarget.value)} disabled={busy} required/></label>
        <label className="np-r358-account-wide">البريد الجديد<input type="email" autoComplete="email" value={nextEmail} onChange={e=>setNextEmail(e.currentTarget.value)} disabled={busy} required placeholder="new@example.com"/></label>
        <div className="np-r358-account-actions np-r358-account-wide"><button type="submit" disabled={busy||parentBusy}>{busy?"جارٍ الإرسال…":"تغيير البريد"}</button></div>
      </form>
    </section>
    <section className="np-r358-account-card np-r358-session-card" aria-labelledby="np-r358-session-title">
      <header><h2 id="np-r358-session-title">الجلسة</h2></header>
      <div className="np-r358-session-actions">
        <button type="button" className="np-r358-secondary" disabled={parentBusy||reconnecting||!onReconnect} onClick={onReconnect}>{reconnecting?"جارٍ التحديث…":"تحديث البيانات"}</button>
        <button type="button" className="np-r358-danger" disabled={parentBusy||logoutPending||!onLogout} onClick={onLogout}>{logoutPending?"جارٍ الخروج…":"تسجيل الخروج"}</button>
      </div>
    </section>
    {photo&&createPortal(<div className="np-profile-crop-backdrop" style={photoViewport} dir="rtl" onMouseDown={event=>{if(event.target===event.currentTarget)closePhoto();}}>
      <section className="np-profile-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="np-photo-crop-title"
        onKeyDown={event=>{if(event.key==="Escape")closePhoto();if(event.key==="Tab"){const controls=[...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),[tabindex='0'],input:not(:disabled)")];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}}>
        <header><h2 id="np-photo-crop-title">ضبط الصورة</h2><button type="button" aria-label="إغلاق ضبط الصورة" disabled={profileBusy} onClick={closePhoto}>×</button></header>
        <div className="np-profile-crop-body">
          <div className="np-profile-crop-preview" tabIndex={0} aria-label="معاينة القص. حرّك بالسحب أو بأسهم لوحة المفاتيح"
            onPointerDown={event=>{if(profileBusy)return;drag.current={x:event.clientX,y:event.clientY,posX:crop.x,posY:crop.y};event.currentTarget.setPointerCapture(event.pointerId);}}
            onPointerMove={event=>{const start=drag.current;if(!start||profileBusy)return;const size=event.currentTarget.clientWidth;movePhoto(start.posX-(event.clientX-start.x)/size,start.posY-(event.clientY-start.y)/size);}}
            onLostPointerCapture={()=>{drag.current=null;}}
            onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)||profileBusy)return;event.preventDefault();movePhoto(crop.x+(event.key==="ArrowLeft"?.05:event.key==="ArrowRight"?-.05:0),crop.y+(event.key==="ArrowUp"?.05:event.key==="ArrowDown"?-.05:0));}}>
            <img src={cropPreview} alt="معاينة الصورة الشخصية" width={192} height={192} draggable={false}/>
          </div>
          <label>التكبير<input type="range" min={1} max={3} step={.05} value={crop.zoom} disabled={profileBusy} onChange={event=>adjustPhoto(photo,{...crop,zoom:Number(event.currentTarget.value)})}/></label>
          {error?<p role="alert" className="np-r312-account-error">{error}</p>:null}
        </div>
        <footer><button type="button" onClick={closePhoto} disabled={profileBusy}>إلغاء</button><button type="button" onClick={()=>{void persistProfile(cropPreview,true);}} disabled={profileBusy||parentBusy||!cropPreview}>{profileBusy?"جارٍ الحفظ…":"حفظ الصورة"}</button></footer>
      </section>
    </div>,document.body)}
    {message?<p className="np-r312-account-notice" role="status">{message}</p>:null}
    {error&&!photo?<p className="np-r312-account-error" role="alert">{error}</p>:null}
  </section>;
}
