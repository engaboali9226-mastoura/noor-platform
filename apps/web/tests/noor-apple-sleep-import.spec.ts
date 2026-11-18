import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {appleSleepMinutes} from '../src/noor-apple-sleep-import.js';
import {sleepWeek,type DailySignals} from '../src/noor-wellbeing-data-r165.js';

const sleep=(value:string,start:string,end:string)=>`<Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysis${value}" startDate="${start}" endDate="${end}"/>`;

test('weekly sleep follow-up counts all ratings equally and flags only low quality',()=>{
  const base:DailySignals={date:'2026-11-14',steps:null,sleepMinutes:null,screenMinutes:null,pickups:null,apps:[],source:'manual'};
  const week=sleepWeek([
    {...base,sleepQuality:'very-low'},
    {...base,date:'2026-11-15',sleepQuality:'very-high'},
    {...base,date:'2026-11-16',sleepMinutes:420,sleepSource:'apple-health'},
    {...base,date:'2026-11-17',steps:1000},
  ],'2026-11-18');
  assert.equal(week?.tracked,3);
  assert.equal(week?.rate,60);
  assert.deepEqual(week?.low.map(day=>day.date),['2026-11-14']);
});

test('sleep import groups overnight stages by wake date, excluding awake time and overlap',()=>{
  const records=[
    sleep('AsleepCore','2026-11-17 23:30:00 +0300','2026-11-18 01:30:00 +0300'),
    sleep('Awake','2026-11-18 01:30:00 +0300','2026-11-18 01:45:00 +0300'),
    sleep('AsleepDeep','2026-11-18 01:45:00 +0300','2026-11-18 05:45:00 +0300'),
    sleep('Asleep','2026-11-18 02:00:00 +0300','2026-11-18 05:30:00 +0300'),
    sleep('InBed','2026-11-17 23:00:00 +0300','2026-11-18 06:00:00 +0300'),
  ];
  const {window}=new JSDOM(`<HealthData>${records.join('')}</HealthData>`,{contentType:'application/xml'});
  assert.equal(appleSleepMinutes(window.document,'2026-11-18','Asia/Riyadh'),360);
  assert.equal(appleSleepMinutes(window.document,'2026-11-17','Asia/Riyadh'),null);
  window.close();
});
