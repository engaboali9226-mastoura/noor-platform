import { useEffect, useState, type FormEvent, type ReactElement } from "react";
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
  const [crop,setCrop]=useState({zoom:1,x:.5,y:.5});
  const [photoBusy,setPhotoBusy]=useState(false);
  const [birthDate,setBirthDate]=useState(profile?.birthDate??"");
  const [profileBusy,setProfileBusy]=useState(false);
  useEffect(()=>{setDisplayName(profile?.displayName??"");setAvatarUrl(profile?.avatarUrl??"");setBirthDate(profile?.birthDate??"");},[profile]);
  const adjustPhoto=(image:HTMLImageElement,position:typeof crop)=>{
    try{setAvatarUrl(cropAvatar(image,position.zoom,position.x,position.y));setCrop(position);setError("");}
    catch{setError("تعذّر تجهيز الصورة. جرّب صورة أخرى.");}
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
      adjustPhoto(image,{zoom:1,x:.5,y:.5});setPhoto(image);
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
  const saveProfile=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!onCommand||profileBusy||parentBusy||photoBusy)return;
    setProfileBusy(true);setError("");setMessage("");
    try{
      const ok=await onCommand({type:"set-personal-profile",expectedUpdatedAt:profile?.updatedAt??null,displayName:displayName.trim(),avatarUrl:avatarUrl.trim()||null,birthDate:birthDate||null});
      if(ok){setMessage("تم حفظ ملفك الشخصي.");setPhoto(null);}
      else setError("تعذّر حفظ ملفك الشخصي. أعد المحاولة بعد تحديث البيانات.");
    }catch{setError("تعذّر الاتصال لحفظ الملف الشخصي.");}
    finally{setProfileBusy(false);}
  };
  return <section className="np-r312-account np-r358-account" data-testid="noor-account-settings-r312" aria-label="إعدادات الحساب">
    <section className="np-r358-account-card" aria-labelledby="np-r358-profile-title">
      <header><h2 id="np-r358-profile-title">الملف الشخصي</h2></header>
      <form className="np-r358-account-grid" onSubmit={event=>{void saveProfile(event);}}>
        <label>الاسم الظاهر<input type="text" maxLength={120} value={displayName} onChange={e=>setDisplayName(e.currentTarget.value)} disabled={profileBusy||parentBusy} required placeholder="الاسم"/></label>
        <label>تاريخ الميلاد<input type="date" value={birthDate} onChange={e=>setBirthDate(e.currentTarget.value)} disabled={profileBusy||parentBusy}/></label>
        <div className="np-r358-account-wide np-profile-photo">
          {avatarUrl?<img src={avatarUrl} alt="معاينة الصورة الشخصية" width={96} height={96}/>:null}
          <label>رفع صورة شخصية<input type="file" accept="image/jpeg,image/png,image/webp" disabled={profileBusy||parentBusy||photoBusy} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";if(file)void choosePhoto(file);}}/></label>
          {photo?<fieldset disabled={profileBusy||parentBusy||photoBusy}>
            <legend>ضبط الصورة</legend>
            {([["zoom","التكبير",1,3],["x","الموضع الأفقي",0,1],["y","الموضع الرأسي",0,1]] as const).map(([key,label,min,max])=><label key={key}>{label}<input type="range" min={min} max={max} step={.05} value={crop[key]} onChange={e=>adjustPhoto(photo,{...crop,[key]:Number(e.currentTarget.value)})}/></label>)}
          </fieldset>:null}
          {avatarUrl?<button type="button" disabled={profileBusy||parentBusy||photoBusy} onClick={()=>{setAvatarUrl("");setPhoto(null);}}>إزالة الصورة</button>:null}
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
    {message?<p className="np-r312-account-notice" role="status">{message}</p>:null}
    {error?<p className="np-r312-account-error" role="alert">{error}</p>:null}
  </section>;
}
