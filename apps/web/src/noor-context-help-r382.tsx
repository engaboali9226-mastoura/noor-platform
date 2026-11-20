import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
/** Contextual guidance only. Never use for errors, irreversible actions or consent. */
export function NoorContextHelp({children,label="مساعدة",className="",testId}:Readonly<{children:ReactNode;label?:string;className?:string;testId?:string}>){
 const [open,setOpen]=useState(false),id=useId();
 const trigger=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;close.current?.focus();return ()=>{trigger.current?.focus();};},[open]);
 return <span className={"noor-context-help-r382 "+className} dir="rtl" data-testid={testId} onKeyDown={event=>{if(event.key==="Escape"&&open){event.preventDefault();event.stopPropagation();setOpen(false);}}}>
  <button ref={trigger} type="button" className="noor-help-trigger-r382" aria-label={label} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={event=>{event.preventDefault();event.stopPropagation();setOpen(value=>!value);}}><span className="noor-help-mark-r384" aria-hidden="true">؟</span></button>
  {!open?<span id={id} hidden className="noor-help-copy-r382">{children}</span>:createPortal(<div className="noor-help-overlay-r384" onClick={event=>{event.stopPropagation();if(event.target===event.currentTarget)setOpen(false);}}><section role="dialog" aria-modal="true" aria-label={label} aria-describedby={id} className="noor-help-dialog-r384" onKeyDown={event=>{if(event.key==="Tab"){event.preventDefault();close.current?.focus();}}}><header><span>مساعدة</span><button type="button" ref={close} aria-label="إغلاق المساعدة" onClick={()=>setOpen(false)}>×</button></header><span id={id} className="noor-help-copy-r382">{children}</span></section></div>,document.body)}
 </span>;
}
