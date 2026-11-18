import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { createNoorAccountSelfServiceR312 } from "./noor-account-self-service-r312.js";
import { readBrowserPublicAuthenticationConfiguration } from "./public-authentication-environment.js";
import type { NoorPersonalCommandInput } from "./noor-personal-today-client.js";

type Profile = Readonly<{displayName:string;avatarUrl:string|null;birthDate:string|null;updatedAt:string}>;

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
  const [birthDate,setBirthDate]=useState(profile?.birthDate??"");
  const [profileBusy,setProfileBusy]=useState(false);
  useEffect(()=>{setDisplayName(profile?.displayName??"");setAvatarUrl(profile?.avatarUrl??"");setBirthDate(profile?.birthDate??"");},[profile]);
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
    if(!onCommand||profileBusy||parentBusy)return;
    setProfileBusy(true);setError("");setMessage("");
    const ok=await onCommand({type:"set-personal-profile",expectedUpdatedAt:profile?.updatedAt??null,displayName:displayName.trim(),avatarUrl:avatarUrl.trim()||null,birthDate:birthDate||null});
    if(ok)setMessage("تم حفظ ملفك الشخصي.");else setError("تعذّر حفظ ملفك الشخصي. أعد المحاولة بعد تحديث البيانات.");
    setProfileBusy(false);
  };
  return <section className="np-r312-account np-r358-account" data-testid="noor-account-settings-r312" aria-label="إعدادات الحساب">
    <section className="np-r358-account-card" aria-labelledby="np-r358-profile-title">
      <header><h2 id="np-r358-profile-title">الملف الشخصي</h2></header>
      <form className="np-r358-account-grid" onSubmit={event=>{void saveProfile(event);}}>
        <label>الاسم الظاهر<input type="text" maxLength={120} value={displayName} onChange={e=>setDisplayName(e.currentTarget.value)} disabled={profileBusy||parentBusy} required placeholder="الاسم"/></label>
        <label>تاريخ الميلاد<input type="date" value={birthDate} onChange={e=>setBirthDate(e.currentTarget.value)} disabled={profileBusy||parentBusy}/></label>
        <label className="np-r358-account-wide">رابط الصورة<input type="url" maxLength={2048} value={avatarUrl} onChange={e=>setAvatarUrl(e.currentTarget.value)} disabled={profileBusy||parentBusy} placeholder="https://…"/></label>
        <div className="np-r358-account-actions np-r358-account-wide"><button type="submit" disabled={profileBusy||parentBusy}>{profileBusy?"جارٍ الحفظ…":"حفظ التغييرات"}</button></div>
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
