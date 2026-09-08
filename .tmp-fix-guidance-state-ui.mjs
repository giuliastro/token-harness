import fs from 'node:fs';
const path='.tmp-guidance-state-ui.mjs';
let text=fs.readFileSync(path,'utf8');
const before="  `  integration.append(rulesButton); card.append(integration);\\n  const reasoning = agent.reasoning;`,";
const after="  `  integration.append(rulesButton); card.append(integration);\\n  const guidanceRule=agent.rules.find(rule=>rule.id===agent.id+'-guidance');\\n  if(guidanceRule?.action) {\\n    const guidance=node('div',undefined,'agent-line'), guidanceText=node('div');\\n    guidanceText.append(node('span','Guidance','key'),node('span','Available on demand'));\\n    guidance.append(guidanceText,actionButton(guidanceRule.action,agent.id+'-guidance','text-button'));card.append(guidance);\\n  }\\n  const reasoning = agent.reasoning;`,";
if(!text.includes(before))throw new Error('old guided-client anchor literal not found');
text=text.replace(before,after);
fs.writeFileSync(path,text);
