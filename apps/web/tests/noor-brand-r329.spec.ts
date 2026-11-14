import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {NOOR_BRAND,NoorBrandHeader,NoorBrandLogo} from "../src/noor-brand-r329.js";
import {PlatformShell} from "../src/platform-shell.js";
import {NoorWorkTeacherViewR264} from "../src/noor-work-teacher-view-r264.js";
const pub=new URL("../public/",import.meta.url);
const expected={
  "icon-180.png": "7217baae6d2b5fac073ef8d32143ca496644020b",
  "icon-192.png": "8985df3c091f6564ebb25690cc5597c109460e7b",
  "icon-32.png": "9d01e36f1be71e5cd7b5fcb2df783c3753a33853",
  "icon-512.png": "73f1f1fdc0cadbb7b39acd95cc2c12ec2c29d038",
  "icon-maskable-192.png": "8cbc7eb4e5dba481f974b5c47ba1aef37b7aaa75",
  "icon-maskable-512.png": "ed75d770e71a5a049883d16b0bb6e47381e2bfe4",
  "personal-header.webp": "42d0633b38699ca64c061f1b5eaef9f5e746eb0c",
  "personal-logo.webp": "94855822010cbbc89e034beff3e5b777c050fd7a",
  "platform-header.webp": "e5f510bed0bd3b76ddac0d52edd69f741252174d",
  "platform-logo.webp": "85b6b684a98fcf08d08e8eeb0b47a846d423a6fe",
  "work-header.webp": "153e51044cb955224c4f5eda0d0ac351c495257e",
  "work-logo.webp": "e232496c74267a416b7252d9b8514c98bb6d08d0"
};
test("R329 all six approved artworks and six install icons match their verified Git blobs",()=>{
 for(const [file,sha] of Object.entries(expected)){const b=readFileSync(new URL("brand/"+file,pub));assert.equal(createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex"),sha,file);}
});
test("R329 scope-specific headers and circular logos have accessible names",()=>{
 for(const scope of ["platform","personal","work"] as const){
  const header=renderToStaticMarkup(createElement(NoorBrandHeader,{scope}));
  const logo=renderToStaticMarkup(createElement(NoorBrandLogo,{scope}));
  assert.ok(header.includes('src="'+NOOR_BRAND[scope].header+'"'));assert.ok(header.includes('alt="'+NOOR_BRAND[scope].label+'"'));
  assert.ok(logo.includes('src="'+NOOR_BRAND[scope].logo+'"'));assert.ok(logo.includes('alt="'+NOOR_BRAND[scope].label+'"'));
 }
});
test("R329 authenticated selector uses Platform header and two distinct circular logos",()=>{
 const h=renderToStaticMarkup(createElement(PlatformShell,{state:{kind:"no-application-selected"},authenticationState:"authenticated",navigate:()=>{}}));
 for(const name of ["platform-header.webp","personal-logo.webp","work-logo.webp"])assert.ok(h.includes("/brand/"+name),name);
});
test("R329 Work initial loading uses Work header",()=>{
 const h=renderToStaticMarkup(createElement(NoorWorkTeacherViewR264));assert.match(h,/src="\/brand\/work-header\.webp"/u);
});
test("R329 Platform install icons are valid and standalone identity is unchanged",()=>{
 const m=JSON.parse(readFileSync(new URL("noor.webmanifest",pub),"utf8"));assert.equal(m.id,"/");assert.equal(m.scope,"/");assert.equal(m.start_url,"/");assert.equal(m.display,"standalone");
 for(const size of [192,512])for(const purpose of ["any","maskable"]){const x=m.icons.find((i:{sizes:string;purpose:string})=>i.sizes===size+"x"+size&&i.purpose===purpose);assert.ok(x);const b=readFileSync(new URL(x.src.slice(1),pub));assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);}
 const b=readFileSync(new URL("brand/icon-180.png",pub));assert.equal(b.readUInt32BE(16),180);assert.equal(b.readUInt32BE(20),180);
 assert.match(readFileSync(new URL("../index.html",import.meta.url),"utf8"),/href="\/brand\/icon-180\.png"/u);
});
