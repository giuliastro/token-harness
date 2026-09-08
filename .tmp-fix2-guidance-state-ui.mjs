import fs from 'node:fs';

// Remove the fragile nested guided-client replacement from the main finalizer.
const patcherPath='.tmp-guidance-state-ui.mjs';
let patcher=fs.readFileSync(patcherPath,'utf8');
const start=patcher.indexOf('// guided-client.ts: put the state directly on each agent card.');
const end=patcher.indexOf('// main.ts: production observer gets the real local filesystem and state root.');
if(start<0||end<=start)throw new Error('guided-client finalizer section not found');
patcher=patcher.slice(0,start)+patcher.slice(end);
fs.writeFileSync(patcherPath,patcher);

// Patch the actual product source using its current #187 block.
const productPath='apps/cli/src/guided-client.ts';
let product=fs.readFileSync(productPath,'utf8');
const before=`  const guidanceRule=agent.rules.find(rule=>rule.id===agent.id+'-guidance');
  if(guidanceRule?.action) {
    const guidance=node('div',undefined,'agent-line'), guidanceText=node('div');
    guidanceText.append(node('span','Guidance','key'),node('span','Available on demand'));
    guidance.append(guidanceText,actionButton(guidanceRule.action,agent.id+'-guidance','text-button'));card.append(guidance);
  }
`;
const after=`  if (agent.guidance) {
    const guidanceLine=node('div',undefined,'agent-line'), guidanceText=node('div');
    guidanceText.append(node('span','Guidance','key'),node('strong',agent.guidance.label)); guidanceLine.append(guidanceText);
    if(agent.guidance.action)guidanceLine.append(actionButton(agent.guidance.action,agent.id+'-guidance','text-button'));
    card.append(guidanceLine);
    if(['external','conflict','unavailable'].includes(agent.guidance.state))card.append(node('p',agent.guidance.description,'subtle-note'));
  }
`;
const first=product.indexOf(before);
if(first<0||product.indexOf(before,first+before.length)>=0)throw new Error('current guided-client guidance block not found exactly once');
product=product.slice(0,first)+after+product.slice(first+before.length);
fs.writeFileSync(productPath,product);
