import { NoorAccountReceipt } from "./noor-account-receipt.js";
import { NoorBrandHeader } from "./noor-brand-r329.js";
import { NoorLoginBrand } from "./noor-login-brand.js";
import { NoorWordmark } from "./noor-wordmark.js";
import {noorTotpQrImageSourceR318} from "./noor-admin-totp-qr-r318.js";
import {createNoorAdminRecoveryR317} from "./noor-admin-recovery-r317.js";
import {NoorAdminAccountsPanelR316} from "./noor-admin-accounts-panel-r316.js";
import {useEffect,useRef,useState,type FormEvent,type ReactElement} from "react";
import {readBrowserPublicAuthenticationConfiguration} from "./public-authentication-environment.js";
import {createNoorAdminMfaSetupR315} from "./noor-admin-mfa-r315.js";

const recoveryReceipts = {
 request: {
  title: "تم استلام طلب الاستعادة",
  details: ["إذا كان البريد مرتبطًا بحساب المدير، سيصلك رابط الاستعادة.", "افتح الرابط على هذا الجهاز."],
  action: "العودة إلى دخول المدير",
 },
 saved: {
  title: "تم تغيير كلمة المرور",
  details: ["تابع لتسجيل الدخول وإكمال المصادقة الثنائية."],
  action: "متابعة إلى دخول المدير",
 },
};

const entryModes = {
 login: { title: "دخول المدير", mode: "admin-login" },
 enroll: { title: "إضافة تطبيق المصادقة", mode: "admin-enroll" },
 verify: { title: "المصادقة الثنائية", mode: "admin-verify" },
 "verify-setup": { title: "المصادقة الثنائية", mode: "admin-verify" },
 "recover-request": { title: "استعادة حساب المدير", mode: "admin-recover-request" },
 "recover-finish": { title: "تعيين كلمة مرور جديدة", mode: "admin-recover-finish" },
};

/**
 * Public identity security setup, NOT an admin dashboard.
 * No account data, role provisioning, account deletion or privileged calls.
 */
export function NoorAdminMfaPageR315({
 createMfa = createNoorAdminMfaSetupR315,
 createRecovery = createNoorAdminRecoveryR317,
}: {
 createMfa?: typeof createNoorAdminMfaSetupR315;
 createRecovery?: typeof createNoorAdminRecoveryR317;
} = {}):ReactElement{
 const service=useRef<ReturnType<typeof createNoorAdminMfaSetupR315>|null>(null);
 if(!service.current)service.current=createMfa(readBrowserPublicAuthenticationConfiguration());
 const recovery=useRef<ReturnType<typeof createNoorAdminRecoveryR317>|null>(null);
 if(!recovery.current)recovery.current=createRecovery(readBrowserPublicAuthenticationConfiguration());
 const [step,setStep]=useState<"login"|"enroll"|"verify"|"verify-setup"|"complete"|"recover-request"|"recover-finish">(
  ()=>typeof window!=="undefined"
   &&(new URLSearchParams(window.location.search).get("auth")==="recovery"
    ||new URLSearchParams(window.location.hash.replace(/^#/u,"")).get("type")==="recovery")
   ?"recover-finish":"login"
 );
 const panel = useRef<HTMLElement>(null);
 const setupDialog = useRef<HTMLDialogElement>(null);
 const verificationInput = useRef<HTMLInputElement>(null);
 const reopenSetupButton = useRef<HTMLButtonElement>(null);
 const [setupView, setSetupView] = useState<"qr" | "key" | null>(null);
 useEffect(() => {
  const dialog = setupDialog.current;
  if (setupView && dialog && !dialog.open) {
   dialog.showModal();
   dialog.querySelector<HTMLElement>(".noor-account-request-receipt-return")?.focus({ preventScroll: true });
  }
 }, [setupView]);
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
 const [code,setCode]=useState("");
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [receipt, setReceipt] = useState<keyof typeof recoveryReceipts | null>(null);
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
   setSetupView(image ? "qr" : result.secret ? "key" : null);
   if (!image && !result.secret) setError("تعذر عرض بيانات إعداد التطبيق. عُد إلى دخول المدير وأعد المحاولة.");
   setStep("verify-setup");
  }finally{setLoading(false);}
 };
 const verify=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(loading)return;setLoading(true);setError("");
  try{
   const result=await service.current!.verify(code.trim());
   if(result==="aal2"){setStep("complete");setQr("");setSecret("");setSetupView(null);setCode("");setNotice("تم التحقق من العامل الثاني. ستظهر الحسابات إذا كانت الصلاحية معتمدة على الخادم.");}
   else setError(result==="invalid"?"رمز التحقق غير صحيح أو منتهي الصلاحية.":"تعذر تأكيد مستوى الحماية. أعد المحاولة.");
  }finally{setLoading(false);}
 };
 const requestRecovery=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(loading)return;
  const form = e.currentTarget;
  const email=String(new FormData(form).get("email")??"").trim();
  setError("");setNotice("");setLoading(true);
  try{
   const result=await recovery.current!.send(email,window.location.origin);
   if(result==="sent"){
    form.reset();
    setReceipt("request");
   }
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
    setReceipt("saved");
   }else setError(result==="invalid"?"الرابط منتهي الصلاحية أو كلمة المرور غير مستوفية للشروط. أعد طلب الرابط.":"تعذر تغيير كلمة المرور. أعد فتح رابط الاستعادة أو اطلب رابطًا جديدًا.");
  }finally{setLoading(false);}
 };
 const logout=async()=>{await service.current?.signOut();setStep("login");setQr("");setSecret("");setSetupView(null);setCode("");setError("");setNotice("");};
 const isEnrolling = step === "enroll";
 const isVerifying = step === "verify" || step === "verify-setup";
 const isRequestingRecovery = step === "recover-request";
 const isFinishingRecovery = step === "recover-finish";
 const returnToLogin = () => {
  setReceipt(null);
  setError("");
  setNotice("");
  setStep("login");
 };
 const showQr = setupView === "qr";
 const codeForm = (
  <form className="noor-welcome-form" onSubmit={event => { void verify(event); }}>
   <label className="noor-login-field">
    <span>رمز التحقق من التطبيق</span>
    <input ref={verificationInput} type="text" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
      className="na315-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}"
      maxLength={6} required dir="ltr" disabled={loading} />
   </label>
   <button type="submit" className="noor-welcome-submit" disabled={loading || code.length !== 6}>
    {loading ? "جارٍ التحقق…" : "تحقق من الرمز"}
   </button>
  </form>
 );

 if (step !== "complete") {
  const entry = entryModes[step];
  return (
   <main id="main-content" className="noor-welcome-gateway-r231 noor-r323-gateway noor-login-gateway noor-admin-entry-gateway"
     data-auth-mode={entry.mode} dir="rtl">
    <div className="noor-welcome-ambient" aria-hidden="true" />
    <section className="noor-welcome-panel noor-admin-entry-panel" ref={panel} data-step={step} aria-labelledby="noor-admin-entry-title">
     <NoorLoginBrand />
     <div className="noor-r323-auth-card noor-r332-auth">
      <h1 className="noor-login-title" id="noor-admin-entry-title">
       {entry.title}
      </h1>
      {isEnrolling ? (
       <div className="noor-welcome-form">
        <button type="button" className="noor-welcome-submit" disabled={loading} onClick={() => { void enroll(); }}>
         {loading ? "جارٍ الإعداد…" : "إنشاء رمز QR"}
        </button>
       </div>
      ) : isVerifying ? codeForm : isRequestingRecovery ? (
       <form key={step} className="noor-welcome-form" onSubmit={event => { void requestRecovery(event); }}>
        <label className="noor-login-field">
         <span>البريد الإلكتروني لحساب الإدارة</span>
         <input name="email" type="email" dir="ltr" autoComplete="username" required disabled={loading} />
        </label>
        <button type="submit" className="noor-welcome-submit" disabled={loading}>
         {loading ? "جارٍ الإرسال…" : "إرسال رابط الاستعادة"}
        </button>
       </form>
      ) : isFinishingRecovery ? (
       <form key={step} className="noor-welcome-form" onSubmit={event => { void finishRecovery(event); }}>
        <label className="noor-login-field">
         <span>كلمة المرور الجديدة</span>
         <input name="password" type="password" dir="ltr" autoComplete="new-password"
           required minLength={12} maxLength={128} disabled={loading} />
        </label>
        <label className="noor-login-field">
         <span>تأكيد كلمة المرور</span>
         <input name="confirm" type="password" dir="ltr" autoComplete="new-password"
           required minLength={12} maxLength={128} disabled={loading} />
        </label>
        <button type="submit" className="noor-welcome-submit" disabled={loading}>
         {loading ? "جارٍ الحفظ…" : "حفظ كلمة المرور الجديدة"}
        </button>
       </form>
      ) : (
       <form key={step} className="noor-welcome-form" onSubmit={event => { void login(event); }}>
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
      {step === "verify-setup" && (qr || secret) && (
       <button ref={reopenSetupButton} type="button" className="noor-auth-return-r312"
         disabled={loading} onClick={() => setSetupView(qr ? "qr" : "key")}>
        عرض إعداد التطبيق
       </button>
      )}
      <button type="button" className="noor-auth-return-r312" disabled={loading} onClick={() => {
       if (isRequestingRecovery) {
        returnToLogin();
       } else if (step === "login" || isFinishingRecovery) {
        if (isFinishingRecovery) window.history.replaceState(null, "", "/admin/security");
        setStep("recover-request");
        setError("");
        setNotice("");
       } else {
        void logout();
       }
      }}>
       {step === "login" ? "إعداد أو استعادة كلمة المرور" : isFinishingRecovery ? "طلب رابط جديد" : "العودة إلى دخول المدير"}
      </button>
      {error && <p role="alert" className="na315-error">{error}</p>}
     </div>
     <a className="noor-r322-admin-entry" href="/">العودة إلى منصة نور</a>
     {receipt && (
      <NoorAccountReceipt copy={recoveryReceipts[receipt]} onDismiss={() => setReceipt(null)} onReturn={returnToLogin} />
     )}
     {setupView && (
      <dialog ref={setupDialog} className="noor-account-request-receipt noor-admin-setup-dialog"
        aria-labelledby="noor-admin-setup-title" aria-describedby="noor-admin-setup-details"
        onClose={event => {
         const target = event.currentTarget.returnValue === "verify" ? verificationInput : reopenSetupButton;
         setSetupView(null);
         target.current?.focus({ preventScroll: true });
        }}>
       <button type="button" className="noor-account-request-receipt-close" aria-label="إغلاق"
         onClick={() => setupDialog.current?.close()}>
        <svg aria-hidden="true" width={16} height={16} viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
         <path d="m4 4 8 8m0-8-8 8" />
        </svg>
       </button>
       <h2 id="noor-admin-setup-title">{showQr ? "ربط تطبيق المصادقة" : "مفتاح الإعداد اليدوي"}</h2>
       <p id="noor-admin-setup-details">{showQr ? "امسح الرمز بتطبيق المصادقة." : "أدخل المفتاح في تطبيق المصادقة."}</p>
       {showQr ? (
        <img className="noor-admin-setup-qr" src={qr} alt="رمز QR لإعداد المصادقة الثنائية" onError={() => {
         setQr("");
         if (secret) setSetupView("key");
         else {
          setupDialog.current?.close();
          setError("تعذر عرض بيانات إعداد التطبيق. عُد إلى دخول المدير وأعد المحاولة.");
         }
        }} />
       ) : <code className="noor-admin-setup-key" dir="ltr">{secret}</code>}
       {qr && secret && (
        <button type="button" className="noor-auth-return-r312" onClick={() => setSetupView(showQr ? "key" : "qr")}>
         {showQr ? "عرض مفتاح الإعداد اليدوي" : "العودة إلى رمز QR"}
        </button>
       )}
       <button type="button" className="noor-account-request-receipt-return"
         onClick={() => setupDialog.current?.close("verify")}>
        إدخال رمز التحقق
       </button>
      </dialog>
     )}
    </section>
   </main>
  );
 }

 return <main className="na315-page" dir="rtl" id="main-content"><section className="na315-panel" ref={panel} data-step={step}>
  <NoorBrandHeader scope="platform" />
  <header><img src="/brand/icon-r369-192.png" alt="شعار نور" width="64" height="64"/><div><p lang="en" dir="ltr"><NoorWordmark /> SECURITY</p><h1>تأمين حساب الإدارة</h1><span>إعداد المصادقة الثنائية TOTP</span></div></header>
  <p className="na315-caution">هذه الصفحة مخصصة لحساب المدير المستقل. لا تظهر إدارة الحسابات إلا بعد المصادقة الثنائية واعتماد دور المدير على الخادم.</p>
  <div className="na315-stage na315-complete" role="status"><h2>اكتملت المصادقة الثنائية ✓</h2><p>تم تأكيد المصادقة الثنائية. لا يسمح الخادم بالإدارة إلا لحساب المدير المعتمد.</p><NoorAdminAccountsPanelR316 token={()=>service.current?.accessToken()??Promise.resolve(null)}/></div>
  {notice?<p role="status" className="na315-notice">{notice}</p>:null}
  {error?<p role="alert" className="na315-error">{error}</p>:null}
  <button className="na315-secondary" type="button" onClick={()=>{void logout();}}>إنهاء جلسة الإعداد</button>
  <a href="/">العودة إلى منصة نور</a>
 </section></main>;
}
