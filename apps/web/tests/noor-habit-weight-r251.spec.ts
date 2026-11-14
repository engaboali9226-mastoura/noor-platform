import assert from "node:assert/strict";
import test from "node:test";
import {proposedHabitWeight,NoorHabitWeightManagerR251,auditPrayerWeightsR334,prayerHabitCandidateR334} from "../src/noor-habit-weight-manager-r251.js";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
const h=(title,importance="Supporting")=>({title,category:"عام",importance});
test("R251 prioritizes the five individual obligatory prayers",()=>{
 for(const name of ["الفجر","الظهر","العصر","المغرب","العشاء","صلاة الفجر","Fajr","Isha"])
   assert.equal(proposedHabitWeight(h(name)),25,name);
 assert.equal(proposedHabitWeight(h("صلاة الضحى")),4);
 assert.equal(proposedHabitWeight(h("سنة الفجر")),4);
});
test("R251 Qur'an and dhikr outrank extra habits without category guessing",()=>{
 assert.equal(proposedHabitWeight(h("القرآن")),12);
 assert.equal(proposedHabitWeight(h("أذكار الصباح")),10);
 assert.equal(proposedHabitWeight(h("Gym")),6);
 assert.equal(proposedHabitWeight(h("Mobility")),5);
 assert.equal(proposedHabitWeight(h("English")),4);
 assert.equal(proposedHabitWeight(h("تعلم جديد","Essential")),14);
 assert.equal(proposedHabitWeight(h("تعلم جديد","Optional")),1);
});
test("R251 review is read-only until authenticated confirmation",()=>{
 const defs=[{id:"f",revisionId:"rev-f",kind:"Habit",title:"الفجر",category:"العبادات",importance:"Essential",weight:1,state:"Active"}] as const;
 const html=renderToStaticMarkup(createElement(NoorHabitWeightManagerR251,{definitions:defs,executions:[{definitionId:"f",kind:"Habit",weight:1,status:"Completed"}],busy:false,onCommand:async()=>false}));
 assert.match(html,/noor-habit-weight-manager-r251/);
 assert.match(html,/إنجاز العادات الحالي: 100٪/);
 assert.match(html,/بعد التطبيق: 100٪/);
 assert.match(html,/مراجعة واعتماد الأوزان/);
 assert.match(html,/value="25"/);
});

test("R334 actual configured weights and prayer aliases are only review hints, never automatic mapping",()=>{
 const d=(id:string,title:string,weight:number,kind:"Habit"|"Task"="Habit",state="Active")=>({id,revisionId:id,title,weight,kind,state,category:"عام",importance:"Essential"});
 const defs=[d("f1","الفجر",25),d("f2","Fajr",35),d("s","سنة الفجر",40),d("t","عمل",80,"Task"),d("old","العشاء",100,"Habit","Archived")];
 const audit=auditPrayerWeightsR334(defs);
 assert.equal(audit.highestConfiguredWeight,80);
 assert.equal(audit.highestOtherWeight,80);
 assert.deepEqual(audit.candidates.map(x=>[x.id,x.key,x.weight]),[["f1","fajr",25],["f2","fajr",35]]);
 assert.equal(prayerHabitCandidateR334("صلاة الضحى"),null);
 assert.equal(prayerHabitCandidateR334("صَلَاةُ الظُّهْر"),"dhuhr");
 const html=renderToStaticMarkup(createElement(NoorHabitWeightManagerR251,{definitions:defs,executions:[],busy:false,onCommand:async()=>false}));
 assert.match(html,/r334-prayer-weight-audit/);
 assert.match(html,/80/);
 assert.match(html,/لا تحفظ أي تغيير/);
});
