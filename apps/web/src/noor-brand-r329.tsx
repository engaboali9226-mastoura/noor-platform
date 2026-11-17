export type NoorBrandScope="platform"|"personal"|"work";
export const NOOR_BRAND={
 platform:{label:"NOOR Platform",header:"/brand/platform-header.webp",logo:"/brand/platform-logo.webp"},
 personal:{label:"NOOR Personal",header:"/brand/personal-header.webp",logo:"/brand/personal-logo.webp",entryLogo:"/brand/icon-r352-192.png"},
 work:{label:"NOOR Work",header:"/brand/work-header.webp",logo:"/brand/work-logo.webp"},
} as const;
export function NoorBrandHeader({scope,className=""}:{scope:NoorBrandScope;className?:string}){
 const brand=NOOR_BRAND[scope];
 return <div className={`noor-r329-brand-header ${className}`} data-noor-brand-scope={scope}><img src={brand.header} alt={brand.label} width={1800} height={600} decoding="async" fetchPriority="high" data-testid={`r329-${scope}-header`}/></div>;
}
export function NoorBrandLogo({scope,alt}:{scope:NoorBrandScope;alt?:string}){
 const brand=NOOR_BRAND[scope];
 return <img src={brand.logo} alt={alt??brand.label} className="noor-r329-brand-logo" width={128} height={128} decoding="async" data-testid={`r329-${scope}-logo`}/>;
}
