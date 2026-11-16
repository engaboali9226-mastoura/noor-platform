import { NoorBrandHeader } from "./noor-brand-r329.js";
import { NoorLoginBrand } from "./noor-login-brand.js";
import { NoorWordmark } from "./noor-wordmark.js";
import {noorTotpQrImageSourceR318} from "./noor-admin-totp-qr-r318.js";
import {createNoorAdminRecoveryR317} from "./noor-admin-recovery-r317.js";
import {NoorAdminAccountsPanelR316} from "./noor-admin-accounts-panel-r316.js";
import {useEffect,useRef,useState,type FormEvent,type ReactElement} from "react";
import {readBrowserPublicAuthenticationConfiguration} from "./public-authentication-environment.js";
import {createNoorAdminMfaSetupR315} from "./noor-admin-mfa-r315.js";

/**
 * Public identity security setup, NOT an admin dashboard.
 * No account data, role provisioning, account deletion or privileged calls.
 */
export function NoorAdminMfaPageR315({
 createMfa = createNoorAdminMfaSetupR315,
}: {createMfa?: typeof createNoorAdminMfaSetupR315} = {}):ReactElement{
 const service=useRef<ReturnType<typeof createNoorAdminMfaSetupR315>|null>(null);
 if(!service.current)service.current=createMfa(readBrowserPublicAuthenticationConfiguration());
 const recovery=useRef<ReturnType<typeof createNoorAdminRecoveryR317>|null>(null);
 if(!recovery.current)recovery.current=createNoorAdminRecoveryR317(readBrowserPublicAuthenticationConfiguration());
 const [step,setStep]=useState<"login"|"enroll"|"verify"|"verify-setup"|"complete"|"recover-request"|"recover-finish">(
  ()=>typeof window!=="undefined"
   &&(new URLSearchParams(window.location.search).get("auth")==="recovery"
    ||new URLSearchParams(window.location.hash.replace(/^#/u,"")).get("type")==="recovery")
   ?"recover-finish":"login"
 );
 const panel = useRef<HTMLElement>(null);
 useEffect(()=>{
  const element = panel.current;
  const viewport = window.visualViewport;
  if(!element || !viewport)return;
  const update = ()=>{
   element.style.setProperty("--noor-admin-viewport",`${viewport.height}px`);
   element.toggleAttribute("data-compact-viewport", viewport.height <= 550);
   const focused = document.activeElement;
   if(element.contains(focused)&&focused instanceof HTMLInputElement){
    focused.scrollIntoView({block:"nearest",inline:"nearest"});
   }
  };
  update();
  viewport.addEventListener("resize",update);
  return ()=>viewport.removeEventListener("resize",update);
 },[step]);
 const [qr,setQr]=useState("");
 const [secret,setSecret]=useState("");
 const [revealSecret,setRevealSecret]=useState(false);
 const [code,setCode]=useState("");
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const login=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(loading)return;
  const form=new FormData(e.currentTarget);
  setLoading(true);setError("");setNotice("");
  try{
   const result=await service.current!.signIn(String(form.get("email")??""),String(form.get("password")??""));
   if(result==="challenge-needed")setStep("verify");
   else if(result==="enroll-needed")setStep("enroll");
   else setError(result==="invalid"?"تعذر تسجيل الدخول بهذه البيانات.":"خدمة التحقق غير متاحة حاليًا.");
  }finally{setLoading(false);}
 };
 const enroll=async()=>{
  if(loading)return;setLoading(true);setError("");
  try{
   const result=await service.current!.enroll();
   if(!result){setError("تعذر بدء المصادقة الثنائية. جرّب تسجيل الدخول مجددًا.");return;}
   // Supabase auth-js has ALREADY prepended the SVG data-URI prefix.
   // Normalize once, never nest data: URIs or inject SVG as markup.
   const image=noorTotpQrImageSourceR318(result.qrSvg);
   setQr(image??"");
   setSecret(result.secret);
   setRevealSecret(false);
   if(!image)setError("تعذر عرض صورة QR. استخدم مفتاح الإعداد اليدوي أدناه.");
   setStep("verify-setup");
   setNotice("امسح رمز QR بتطبيق المصادقة ثم أدخل رمز التحقق المكوّن من ستة أرقام.");
  }finally{setLoading(false);}
 };
 const verify=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(loading)return;setLoading(true);setError("");
  try{
   const result=await service.current!.verify(code.trim());
   if(result==="aal2"){setStep("complete");setQr("");setSecret("");setRevealSecret(false);setCode("");setNotice("تم التحقق من العامل الثاني. ستظهر الحسابات إذا كانت الصلاحية معتمدة على الخادم.");}
   else setError(result==="invalid"?"رمز التحقق غير صحيح أو منتهي الصلاحية.":"تعذر تأكيد مستوى الحماية. أعد المحاولة.");
  }finally{setLoading(false);}
 };
 const requestRecovery=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(loading)return;
  const email=String(new FormData(e.currentTarget).get("email")??"").trim();
  setError("");setNotice("");setLoading(true);
  try{
   const result=await recovery.current!.send(email,window.location.origin);
   if(result==="sent")setNotice("إن كان البريد مرتبطًا بالحساب، ستصلك رسالة استعادة كلمة المرور. افتح الرابط على هذا الجهاز لإعداد كلمة مرور جديدة.");
   else setError("لم نتمكن من إرسال رابط الاستعادة. تحقق من البريد أو إعدادات إرسال الرسائل ثم حاول مجددًا.");
  }finally{setLoading(false);}
 };
 const finishRecovery=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(loading)return;
  const values=new FormData(e.currentTarget);
  const password=String(values.get("password")??"");
  const confirm=String(values.get("confirm")??"");
  if(password!==confirm){setError("كلمتا المرور غير متطابقتين.");return;}
  setError("");setNotice("");setLoading(true);
  try{
   const result=await recovery.current!.complete(password);
   if(result==="updated"){
    window.history.replaceState(null,"","/admin/security");
    setStep("login");
    setNotice("تم تعيين كلمة المرور بنجاح. سجّل الدخول بها الآن، ثم أكمل المصادقة الثنائية.");
   }else setError(result==="invalid"?"الرابط منتهي الصلاحية أو كلمة المرور غير مستوفية للشروط. أعد طلب الرابط.":"تعذر تغيير كلمة المرور. أعد فتح رابط الاستعادة أو اطلب رابطًا جديدًا.");
  }finally{setLoading(false);}
 };
 const logout=async()=>{await service.current?.signOut();setStep("login");setQr("");setSecret("");setRevealSecret(false);setCode("");setError("");setNotice("");};
 const showCodeOnly = step === "verify";
 const codeForm = (
  <form className={showCodeOnly ? "noor-welcome-form" : undefined} onSubmit={event => { void verify(event); }}>
   <label className={showCodeOnly ? "noor-login-field" : undefined}>
    <span>{showCodeOnly ? "رمز التحقق من التطبيق" : "رمز التحقق"}</span>
    <input type="text" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
      className="na315-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}"
      maxLength={6} required dir="ltr" disabled={loading} />
   </label>
   <button type="submit" className={showCodeOnly ? "noor-welcome-submit" : undefined} disabled={loading || code.length !== 6}>
    {loading ? "جارٍ التحقق…" : "تحقق من الرمز"}
   </button>
  </form>
 );

 if (step === "login" || showCodeOnly) {
  return (
   <main id="main-content" className="noor-welcome-gateway-r231 noor-r323-gateway noor-login-gateway noor-admin-entry-gateway"
     data-auth-mode={showCodeOnly ? "admin-verify" : "admin-login"} dir="rtl">
    <div className="noor-welcome-ambient" aria-hidden="true" />
    <section className="noor-welcome-panel noor-admin-entry-panel" ref={panel} data-step={step} aria-labelledby="noor-admin-entry-title">
     <NoorLoginBrand />
     <div className="noor-r323-auth-card noor-r332-auth">
      <h1 className="noor-login-title" id="noor-admin-entry-title">
       {showCodeOnly ? "المصادقة الثنائية" : "دخول المدير"}
      </h1>
      {showCodeOnly ? codeForm : (
       <form className="noor-welcome-form" onSubmit={event => { void login(event); }}>
        <label className="noor-login-field">
         <span>البريد الإلكتروني لحساب الإدارة</span>
         <input name="email" type="email" autoComplete="username" required dir="ltr" disabled={loading} />
        </label>
        <label className="noor-login-field">
         <span>كلمة المرور</span>
         <input name="password" type="password" autoComplete="current-password" required dir="ltr" disabled={loading} />
        </label>
        <button className="noor-welcome-submit" type="submit" disabled={loading}>
         {loading ? "جارٍ التحقق…" : "متابعة للتحقق"}
        </button>
       </form>
      )}
      <button type="button" className="noor-auth-return-r312" disabled={loading} onClick={() => {
       if (showCodeOnly) {
        void logout();
       } else {
        setStep("recover-request");
        setError("");
        setNotice("");
       }
      }}>
       {showCodeOnly ? "العودة إلى دخول المدير" : "إعداد أو استعادة كلمة المرور"}
      </button>
      {notice && <p role="status" className="na315-notice">{notice}</p>}
      {error && <p role="alert" className="na315-error">{error}</p>}
     </div>
     <a className="noor-r322-admin-entry" href="/">العودة إلى منصة نور</a>
    </section>
   </main>
  );
 }

 return <main className="na315-page" dir="rtl" id="main-content"><section className="na315-panel" ref={panel} data-step={step}>
  <NoorBrandHeader scope="platform" />
  <header><img src="/brand/platform-logo.webp" alt="شعار نور" width="64" height="64"/><div><p lang="en" dir="ltr"><NoorWordmark /> SECURITY</p><h1>تأمين حساب الإدارة</h1><span>إعداد المصادقة الثنائية TOTP</span></div></header>
  <p className="na315-caution">هذه الصفحة مخصصة لحساب المدير المستقل. لا تظهر إدارة الحسابات إلا بعد المصادقة الثنائية واعتماد دور المدير على الخادم.</p>
  {step==="recover-request"?<div className="na315-stage"><h2>إرسال رابط استعادة كلمة المرور</h2>
   <p>سنرسل رابطًا إلى البريد الإلكتروني الذي تملكه. لن تُنشأ هوية جديدة ولن تُمنح صلاحية إدارة تلقائيًا.</p>
   <form onSubmit={e=>{void requestRecovery(e);}}>
    <label>البريد الإلكتروني<input name="email" type="email" autoComplete="username" required dir="ltr" disabled={loading}/></label>
    <button type="submit" disabled={loading}>{loading?"جارٍ الإرسال…":"إرسال رابط الاستعادة"}</button>
   </form>
   <button type="button" className="na315-secondary" disabled={loading} onClick={()=>{setStep("login");setError("");}}>العودة لتسجيل الدخول</button>
  </div>:null}
  {step==="recover-finish"?<div className="na315-stage"><h2>تعيين كلمة مرور جديدة</h2>
   <p>لن تُقبل كلمة مرور جديدة إلا إذا تحقق Supabase من رابط الاستعادة في متصفحك.</p>
   <form onSubmit={e=>{void finishRecovery(e);}}>
    <label>كلمة مرور جديدة (12 حرفًا على الأقل)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" dir="ltr" disabled={loading}/></label>
    <label>تأكيد كلمة المرور<input name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" dir="ltr" disabled={loading}/></label>
    <button type="submit" disabled={loading}>{loading?"جارٍ الحفظ…":"تعيين كلمة المرور"}</button>
   </form>
   <button type="button" className="na315-secondary" onClick={()=>{window.history.replaceState(null,"","/admin/security");setStep("recover-request");setError("");}}>طلب رابط جديد</button>
  </div>:null}
  {step==="enroll"?<div className="na315-stage"><h2>إضافة تطبيق المصادقة</h2><p>استخدم تطبيقًا مثل Microsoft Authenticator أو Google Authenticator لإنشاء رمز دوري مرتبط بهذا الحساب.</p><button type="button" disabled={loading} onClick={()=>{void enroll();}}>إنشاء رمز QR</button></div>:null}
  {step==="verify-setup"?<div className="na315-stage">
   {qr?<><h2>امسح رمز QR</h2>
    <img className="na315-qr" src={qr} alt="رمز QR خاص بإعداد المصادقة الثنائية" onError={()=>{setQr("");setError("تعذر عرض صورة QR على هذا المتصفح. استخدم مفتاح الإعداد اليدوي أدناه.");}}/>
    <p>لا تشارك هذا الرمز مع أحد. لن يُحفظ في نور.</p>
   </>:<h2>التحقق من تطبيق المصادقة</h2>}
   {secret?<div className="na315-manual">
    <p>لو بتستخدم نفس الآيفون أو تعذر مسح رمز QR، افتح تطبيق المصادقة واختر إضافة حساب بمفتاح إعداد يدوي (Time-based / TOTP).</p>
    <button type="button" className="na315-secondary" onClick={()=>setRevealSecret(value=>!value)}>{revealSecret?"إخفاء مفتاح الإعداد":"عرض مفتاح الإعداد اليدوي"}</button>
    {revealSecret?<div><p>مفتاح سري خاص بحسابك؛ لا تشاركه أو تلتقط له صورة.</p><code className="na315-secret" dir="ltr">{secret}</code></div>:null}
   </div>:null}
   {codeForm}
  </div>:null}
  {step==="complete"?<div className="na315-stage na315-complete" role="status"><h2>اكتملت المصادقة الثنائية ✓</h2><p>تم تأكيد المصادقة الثنائية. لا يسمح الخادم بالإدارة إلا لحساب المدير المعتمد.</p><NoorAdminAccountsPanelR316 token={()=>service.current?.accessToken()??Promise.resolve(null)}/></div>:null}
  {notice?<p role="status" className="na315-notice">{notice}</p>:null}
  {error?<p role="alert" className="na315-error">{error}</p>:null}
  {step!=="recover-request"&&step!=="recover-finish"?<button className="na315-secondary" type="button" onClick={()=>{void logout();}}>إنهاء جلسة الإعداد</button>:null}
  <a href="/">العودة إلى منصة نور</a>
 </section></main>;
}
