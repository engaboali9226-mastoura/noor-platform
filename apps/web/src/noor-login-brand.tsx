import { NoorWordmark } from "./noor-wordmark.js";

export function NoorLoginBrand() {
  return (
    <header className="noor-login-brand">
      <img src="/brand/login-calligraphy.webp" alt="" width={295} height={246} />
      <p className="noor-login-wordmark" lang="en" dir="ltr"><NoorWordmark /> Platform</p>
      <p className="noor-login-tagline">خصّص مساحتك، عزّز إنتاجيتك</p>
    </header>
  );
}
