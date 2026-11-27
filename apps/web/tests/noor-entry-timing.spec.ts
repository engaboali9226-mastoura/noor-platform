import assert from "node:assert/strict";
import test from "node:test";
import {startPersonalEntry,finishPersonalEntry,cancelPersonalEntry} from "../src/noor-entry-timing.js";
test("N1 local entry measurement records only the current completed entry",()=>{
 startPersonalEntry();cancelPersonalEntry();finishPersonalEntry();
 assert.equal(performance.getEntriesByName("noor:personal:click-to-ready").length,0);
 startPersonalEntry();finishPersonalEntry();finishPersonalEntry();
 const values=performance.getEntriesByName("noor:personal:click-to-ready");
 assert.equal(values.length,1);assert.ok(values[0]!.duration>=0);
 assert.equal(performance.getEntriesByName("noor:personal:entry-click").length,0);
 startPersonalEntry();assert.equal(performance.getEntriesByName("noor:personal:click-to-ready").length,0);cancelPersonalEntry();
});
