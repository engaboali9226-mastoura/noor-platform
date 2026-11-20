// R381 public anniversaries: no account data, no writes to personal storage.
import {createHash} from 'node:crypto';
import {reviewedIslamicDay,eligibleWorldHistory} from './noor-islamic-history-r382.mjs';
const months={gregorian:['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],hijri:['محرم','صفر','ربيع الأول','ربيع الآخر','جمادى الأولى','جمادى الآخرة','رجب','شعبان','رمضان','شوال','ذو القعدة','ذو الحجة']};
const categoryPatterns=[
 ['الغزوات والفتوحات',/غزو[ةه]|فتوحات|فتح (?:مكة|بلاد|مدينة|القسطنطينية)/u,9],
 ['الحروب والمعارك',/معرك[ةه]|حرب|حروب|غارة|اجتياح|حصار|غزو|احتلال|استقلال|انقلاب|ثورة/u,8],
 ['الدول والسياسة',/قيام (?:دولة|الدولة|الاتحاد|الجمهورية)|سقوط|تأسيس|إعلان (?:قيام|استقلال)|دستور|انتخابات|تنصيب|محاكم[ةات]/u,6],
 ['المعاهدات',/معاهد[ةه]|اتفاقي[ةه]|اتفاق السلام|هدنة/u,7],
 ['العلم والحضارة',/اختراع|اكتشاف|إطلاق (?:قمر|مركبة|مسبار)|افتتاح|جامعة|أول (?:رحلة|قمر|مركبة|مفاعل)|تلسكوب/u,5],
 ['الكوارث الكبرى',/زلزال|بركان|إعصار|كارثة|تسونامي/u,4],
];
const plain=s=>s.replace(/<!--[\s\S]*?-->/g,'').replace(/<ref\b[^>]*\/\s*>|<ref\b[^>]*>[\s\S]*?<\/ref>/gi,'').replace(/\{\{[^{}]*\}\}/g,'').replace(/\[\[(?:ملف|صورة|File|Image|تصنيف|Category):[^\]]*\]\]/gi,'').replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g,'$2').replace(/\[\[([^\]]+)\]\]/g,'$1').replace(/'{2,5}/g,'').replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
const digits=s=>s.replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c>='۰'?1776:1632)));
const wikiTitle=s=>typeof s==='string'&&s.length<180&&!/[:#<>\[\]{}|]/u.test(s);
export function validHistoryDay(calendar,month,day){
 return Object.hasOwn(months,calendar)&&Number.isInteger(month)&&month>=1&&month<=12&&Number.isInteger(day)&&day>=1&&day<=(calendar==='hijri'?30:new Date(Date.UTC(2000,month,0)).getUTCDate());
}
export function parseHistoryDay({calendar,month,day,wikitext,revision}){
 if(!validHistoryDay(calendar,month,day)||typeof wikitext!=='string'||wikitext.length>500000)return [];
 const page=day+' '+months[calendar][month-1];
 const sourceUrl='https://ar.wikipedia.org/wiki/'+encodeURIComponent(page.replaceAll(' ','_'))+(Number.isSafeInteger(revision)&&revision>0?'?oldid='+revision:'');
 let active=false,year=null;
 const found=new Map();
 for(const line of wikitext.split(/\r?\n/)){
  const heading=line.match(/^\s*==+\s*(.*?)\s*==+\s*$/u);
  if(heading){active=/^(?:أحداث|الأحداث|احداث|الاحداث)$/u.test(plain(heading[1]));year=null;continue;}
  if(!active)continue;
  const bullet=line.match(/^\s*(\*+)\s*(.*)$/u);
  if(!bullet)continue;
  const raw=bullet[2],clean=digits(plain(raw));
  const prefix=clean.match(/^(\d{1,4})\s*(?:هـ|ه‍|ه|م|ق\.?\s*م\.?)?\s*[-–—:]\s*(.*)$/u);
  if(prefix){year=Number(prefix[1]);if(/ق\.?\s*م/u.test(clean.slice(0,20)))year=-year;}
  else if(bullet[1].length===1){year=null;continue;}
  if(!Number.isInteger(year)||year===0)continue;
  const details=(prefix?prefix[2]:clean).trim();
  if(details.length<12||details.length>1800||/^\s*(?:ولادة|ميلاد|وفاة|زفاف|حفل زفاف)/u.test(details))continue;
  const classified=categoryPatterns.filter(([,re])=>re.test(details)).sort((a,b)=>b[2]-a[2])[0];
  if(!classified)continue;
  const links=[...raw.matchAll(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g)].map(m=>({page:m[1].trim(),label:plain(m[2]??m[1])})).filter(x=>wikiTitle(x.page)&&!/^\d/u.test(digits(x.page)));
  const preferred=links.find(x=>classified[1].test(x.label)&&x.label.length>=5)??links.find(x=>/معرك|حرب|غزو|معاهد|اتفاقي|محاكم|ثورة|انقلاب|استقلال/u.test(x.label)&&x.label.length>=5);
  const article=preferred?.page??null;
  const title=preferred?.label??(details.length>72?details.slice(0,72).replace(/\s+\S*$/u,'')+'…':details);
  const key=year+':'+(article??details).normalize('NFKC').replace(/\s+/g,' ').trim();
  if(found.has(key))continue;
  found.set(key,{id:'wiki:'+createHash('sha256').update(calendar+':'+month+':'+day+':'+key).digest('hex').slice(0,20),calendar,month,day,year,title,details:details.slice(0,1100),category:classified[0],rank:classified[2],source:'ويكيبيديا العربية',sourceUrl,article,articleUrl:article?'https://ar.wikipedia.org/wiki/'+encodeURIComponent(article.replaceAll(' ','_')):null,license:'CC BY-SA 4.0'});
 }
 return [...found.values()].sort((a,b)=>b.rank-a.rank||a.year-b.year).slice(0,12);
}
const ttl=24*60*60*1000,retry=5*60*1000;
export function createHistoryEngine({request=fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();
 let active=0;
 async function json(params,commons=false){
  const url=new URL(commons?'https://commons.wikimedia.org/w/api.php':'https://ar.wikipedia.org/w/api.php');
  url.search=new URLSearchParams({...params,format:'json',formatversion:'2',maxlag:'5'}).toString();
  const response=await request(url,{headers:{'User-Agent':'NOOR-History/1.0 (https://noor-personal.onrender.com)','Accept':'application/json'},signal:AbortSignal.timeout(5000),redirect:'error'});
  if(!response.ok)throw Error('HISTORY_UPSTREAM');
  const body=await response.json();if(body.error)throw Error('HISTORY_UPSTREAM');return body;
 }
 async function load(calendar,month,day){
  const page=day+' '+months[calendar][month-1];
  const body=await json({action:'parse',page,prop:'wikitext|revid',redirects:'1'});
  if(typeof body.parse?.wikitext!=='string')throw Error('HISTORY_FORMAT');
  const rows=parseHistoryDay({calendar,month,day,wikitext:body.parse.wikitext,revision:body.parse.revid}).filter(row=>eligibleWorldHistory([row.title,row.details,row.article??''].join(' '))).map(row=>({...row,scope:'world'}));
  // Use the structured Wikidata entity identifiers exposed by MediaWiki.
  // This is identity enrichment, not independent historical corroboration.
  const titles=[...new Set(rows.map(e=>e.article).filter(Boolean))];
  if(titles.length)try{
   const data=await json({action:'query',titles:titles.join('|'),prop:'pageprops|pageimages',ppprop:'wikibase_item',piprop:'name',pilicense:'free',redirects:'1'});
   const alias=new Map([...(data.query?.normalized??[]),...(data.query?.redirects??[])].map(x=>[x.from,x.to]));
   const pages=new Map((data.query?.pages??[]).map(p=>[p.title,p]));
   const images=new Map();
   for(const row of rows){
    const p=pages.get(alias.get(row.article)??row.article),id=p?.pageprops?.wikibase_item;
    if(typeof id==='string'&&/^Q[1-9]\d*$/u.test(id))row.wikidataUrl='https://www.wikidata.org/wiki/'+id;
    if(typeof p?.pageimage==='string'&&p.pageimage.length<200&&!/[\x00-\x1f|\[\]<>]/u.test(p.pageimage)&&/\.(?:jpe?g|png|webp)$/i.test(p.pageimage)&&images.size<3)images.set(row,'File:'+p.pageimage);
   }
   if(images.size)try{
    const media=await json({action:'query',titles:[...new Set(images.values())].join('|'),prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'240',iiextmetadatafilter:'LicenseShortName|Artist|LicenseUrl'},true);
    const info=new Map((media.query?.pages??[]).filter(p=>p.imagerepository==='local').map(p=>[p.title,p.imageinfo?.[0]]));
    for(const [row,title] of images){
     const image=info.get(title),metadata=image?.extmetadata;
     const license=metadata?.LicenseShortName?.value,artist=typeof metadata?.Artist?.value==='string'?plain(metadata.Artist.value).slice(0,180):'';
     if(typeof license!=='string'||!/^(?:CC BY(?:-SA)? [1-4]\.0|CC0|Public domain)$/i.test(license)||!artist||typeof image?.thumburl!=='string')continue;
     const url=new URL(image.thumburl);
     if(url.origin!=='https://upload.wikimedia.org'||!url.pathname.startsWith('/wikipedia/commons/'))continue;
     row.image={url:url.href,artist,license,sourceUrl:'https://commons.wikimedia.org/wiki/'+encodeURIComponent(title.replaceAll(' ','_'))};
    }
   }catch{/* never display an image without Commons attribution */}

  }catch{/* optional enrichment never blocks a valid anniversary */}
  const seen=new Set();
  return rows.filter(row=>{const key=row.wikidataUrl?row.year+':'+row.wikidataUrl:row.id;if(seen.has(key))return false;seen.add(key);return true;});
 }
 return async function getDay(calendar,month,day){
  if(!validHistoryDay(calendar,month,day))return {status:'invalid',events:[]};
  const approved=reviewedIslamicDay(calendar,month,day);
  if(calendar==='hijri')return {status:'ok',events:approved}; // Never call Wikipedia for Islamic history.
  const key=[calendar,month,day].join(':'),cached=cache.get(key),at=now();
  if(cached&&cached.expires>at)return cached.value;
  if(pending.has(key))return pending.get(key);
  if(active>=4)return cached?{...cached.value,status:'stale'}:{status:'unavailable',events:[]};
  active++;
  const work=(async()=>{
   try{
    const events=[...approved,...await load(calendar,month,day)].slice(0,12),value={status:'ok',events};
    cache.set(key,{value,expires:now()+ttl});return value;
   }catch{
    const value=cached&&cached.value.status!=='unavailable'?{...cached.value,status:'stale'}:{status:approved.length?'stale':'unavailable',events:approved};
    cache.set(key,{value,expires:now()+retry});return value;
   }finally{active--;pending.delete(key);}
  })();
  pending.set(key,work);return work;
 };
}
