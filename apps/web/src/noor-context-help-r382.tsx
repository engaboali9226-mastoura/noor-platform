import {useId,useState,type ReactNode} from "react";
/** Contextual guidance only. Never use for errors, irreversible actions or consent. */
export function NoorContextHelp({children,label="مساعدة",className="",testId}:Readonly<{children:ReactNode;label?:string;className?:string;testId?:string}>){
 const [open,setOpen]=useState(false),id=useId();
 return <span className={"noor-context-help-r382 "+className} dir="rtl" data-testid={testId} onKeyDown={event=>{if(event.key==="Escape"&&open){event.stopPropagation();setOpen(false);}}}>
  <button type="button" className="noor-help-trigger-r382" aria-label={label} aria-expanded={open} aria-controls={id} onClick={event=>{event.preventDefault();event.stopPropagation();setOpen(value=>!value);}}>؟</button>
  <span id={id} hidden={!open} className="noor-help-copy-r382">{children}</span>
 </span>;
}
