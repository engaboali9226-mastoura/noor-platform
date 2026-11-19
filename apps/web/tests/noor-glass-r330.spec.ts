import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {NOOR_APPEARANCES,normalizeAppearance,readAppearance} from "../src/appearance-preference-store.js";
const pub=new URL("../public/",import.meta.url);
test("R330 defaults to blue including legacy Noor and offers six validated themes",()=>{
 assert.equal(normalizeAppearance("noor"),"blue");assert.equal(normalizeAppearance(null),"blue");assert.equal(normalizeAppearance("invalid"),"blue");assert.equal(readAppearance(),"blue");
 assert.deepEqual(NOOR_APPEARANCES.map(x=>x[0]),["blue","beige","sage","lavender","light","dark"]);
 for(const [id] of NOOR_APPEARANCES)assert.equal(normalizeAppearance(id),id);
});
test("R330 enlarged PNGs exactly match verified original-logo crops",()=>{
 const hashes={32:"9c6822a2e9249f306b7ece5ab16bdfb5fc7faa50",180:"74a07e67a3cdd12c83d6b38ddac2827d98a48144",192:"e6db45336e88305e410058c6ee035ecdb66a999e",512:"ea6f4dec2fe9e5f7a92e9b4470f8c2b0fbbb1a6e"};
 for(const [size,sha] of Object.entries(hashes)){
  const b=readFileSync(new URL("brand/icon-r330-"+size+".png",pub));assert.equal(b.readUInt32BE(16),Number(size));assert.equal(b.readUInt32BE(20),Number(size));assert.equal(createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex"),sha);
 }
 const manifest=JSON.parse(readFileSync(new URL("noor.webmanifest",pub),"utf8"));
 for(const n of [192,512]){assert.ok(manifest.icons.some((x:{src:string;purpose:string})=>x.src==="/brand/icon-r369-"+n+".png"&&x.purpose==="any"));}
});
