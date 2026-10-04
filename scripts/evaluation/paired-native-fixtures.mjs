import fs from 'node:fs/promises';
import path from 'node:path';
export const tasks = {
  mechanical: {
    effort: 'low',
    source:
      'export function inclusiveRange(start,end){return Array.from({length:end-start},(_,i)=>start+i)}\n',
    objective:
      'Fix inclusiveRange(start,end) to include both integer bounds. Return [] when start>end and throw TypeError for noninteger bounds.',
    tests: `import assert from 'node:assert/strict';import {test} from 'node:test';import {inclusiveRange} from './solution.mjs';
for(let start=-10;start<10;start++)test('inclusive range '+start,()=>{assert.deepEqual(inclusiveRange(start,start+3),[start,start+1,start+2,start+3]);assert.deepEqual(inclusiveRange(start,start),[start]);assert.deepEqual(inclusiveRange(start,start-1),[])});
for(const value of [0.5,NaN,Infinity,'1'])test('reject noninteger '+String(value),()=>{assert.throws(()=>inclusiveRange(value,2),TypeError);assert.throws(()=>inclusiveRange(1,value),TypeError)});`,
  },
  standard: {
    effort: 'medium',
    source:
      'export function summarizeOrders(orders){return {netCents:0,paid:0,cancelled:0,byCurrency:{}}}\n',
    objective:
      'Implement summarizeOrders. Ignore cancelled orders for revenue; count paid/cancelled orders. For each paid order subtract refundedCents (default0) from totalCents, aggregate netCents overall and byCurrency. Accept only nonnegative safe integer cent values with refund<=total, currency /^[A-Z]{3}$/ and status paid or cancelled; throw TypeError for invalid input. Do not mutate orders.',
    tests: `import assert from 'node:assert/strict';import {test} from 'node:test';import {summarizeOrders} from './solution.mjs';
test('empty',()=>assert.deepEqual(summarizeOrders([]),{netCents:0,paid:0,cancelled:0,byCurrency:{}}));
for(let n=1;n<=20;n++)test('aggregate '+n,()=>{const input=[{status:'paid',currency:'EUR',totalCents:n*100,refundedCents:25},{status:'paid',currency:'USD',totalCents:75},{status:'cancelled',currency:'EUR',totalCents:100000}];const before=JSON.stringify(input);assert.deepEqual(summarizeOrders(input),{netCents:n*100+50,paid:2,cancelled:1,byCurrency:{EUR:n*100-25,USD:75}});assert.equal(JSON.stringify(input),before)});
for(const patch of [{totalCents:-1},{totalCents:1.5},{refundedCents:101},{refundedCents:-1},{currency:'eur'},{currency:'__proto__'},{status:'pending'}])test('invalid '+JSON.stringify(patch),()=>assert.throws(()=>summarizeOrders([{status:'paid',currency:'EUR',totalCents:100,...patch}]),TypeError));
test('invalid array',()=>assert.throws(()=>summarizeOrders(null),TypeError));`,
  },
  hard: {
    effort: 'high',
    source:
      'export async function mapBounded(items,worker,{concurrency=2,signal}={}){return Promise.all(items.map(worker))}\n',
    objective:
      'Implement mapBounded(items,worker,{concurrency=2,signal}). Enforce a positive integer concurrency bound; preserve input result order; pass (item,index,signal) to worker. Start workers synchronously in input order until the bound; launch more only as earlier work settles. On first rejection or abort stop launching new work, wait for every already-started worker to settle (no unhandled rejections), then reject with the first observed error (signal.reason for abort). An already-aborted signal starts no work. Empty input returns[]. Validate array, worker function and concurrency. Avoid mutation.',
    tests: `import assert from 'node:assert/strict';import {test} from 'node:test';import {mapBounded} from './solution.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};const tick=()=>new Promise(r=>setImmediate(r));
for(const concurrency of [1,2,3,4])test('bound and order '+concurrency,async()=>{let active=0,max=0;const input=Array.from({length:12},(_,i)=>i);const result=await mapBounded(input,async(x,i)=>{assert.equal(x,i);active++;max=Math.max(max,active);await tick();active--;return x*2},{concurrency});assert.ok(max<=concurrency);assert.deepEqual(result,input.map(x=>x*2));assert.deepEqual(input,Array.from({length:12},(_,i)=>i))});
for(let repeat=0;repeat<10;repeat++)test('wait for active rejection '+repeat,async()=>{const a=deferred(),b=deferred(),error=new Error('first');let calls=0,settled=false;const task=mapBounded([0,1,2,3],()=>[a.promise,b.promise][calls++],{concurrency:2});const observed=task.then(()=>{settled=true},e=>{settled=true;return e});assert.equal(calls,2);a.reject(error);await tick();assert.equal(calls,2);assert.equal(settled,false);b.reject(new Error('second'));assert.equal(await observed,error);assert.equal(calls,2)});
for(let repeat=0;repeat<10;repeat++)test('abort waits '+repeat,async()=>{const controller=new AbortController(),a=deferred(),error=new Error('aborted');let calls=0,settled=false;const task=mapBounded([0,1,2],(x,i,signal)=>{assert.equal(signal,controller.signal);calls++;return a.promise},{concurrency:1,signal:controller.signal});const observed=task.then(()=>{settled=true},e=>{settled=true;return e});controller.abort(error);await tick();assert.equal(calls,1);assert.equal(settled,false);a.resolve(0);assert.equal(await observed,error);assert.equal(calls,1)});
test('preabort and empty',async()=>{const c=new AbortController();c.abort(new Error('early'));let calls=0;await assert.rejects(mapBounded([1],()=>{calls++},{signal:c.signal}),/early/);assert.equal(calls,0);assert.deepEqual(await mapBounded([],()=>0),[])});
for(const concurrency of [0,-1,1.5,NaN,Infinity])test('invalid concurrency '+String(concurrency),async()=>assert.rejects(mapBounded([1],()=>0,{concurrency}),TypeError));
test('invalid input and worker',async()=>{await assert.rejects(mapBounded(null,()=>0),TypeError);await assert.rejects(mapBounded([],null),TypeError)});`,
  },
};
export async function writeFixture(folder, taskClass) {
  await fs.mkdir(folder, { recursive: true });
  const task = tasks[taskClass];
  await fs.writeFile(path.join(folder, 'solution.mjs'), task.source, { flag: 'wx' });
  await fs.writeFile(path.join(folder, 'acceptance.test.mjs'), task.tests + '\n', { flag: 'wx' });
  return task;
}
