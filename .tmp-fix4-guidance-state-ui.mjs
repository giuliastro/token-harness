import fs from 'node:fs';

function replaceOnce(path,before,after){
  let text=fs.readFileSync(path,'utf8');
  const first=text.indexOf(before);
  if(first<0||text.indexOf(before,first+before.length)>=0)throw new Error(`${path}: expected one hardening anchor`);
  text=text.slice(0,first)+after+text.slice(first+before.length);
  fs.writeFileSync(path,text);
}

replaceOnce(
  'apps/cli/src/agent-skill.ts',
  `        if (!relevant) continue;\n        if (journal.outcome === 'rolled-back') continue;\n        latestRelevant = journal;`,
  `        if (!relevant) continue;\n        // The newest relevant transaction is authoritative even when it was rolled back.\n        // Falling through to an older commit could resurrect a stale ownership claim.\n        latestRelevant = journal;`,
);

replaceOnce(
  'apps/cli/test/agent-skill-install.test.ts',
  `      return [...new Set(Object.keys(entries).filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length).split('/')[0]).filter(Boolean))];`,
  `      const names = Object.keys(entries)\n        .filter((key) => key.startsWith(prefix))\n        .map((key) => key.slice(prefix.length).split('/')[0]);\n      return [...new Set(names.filter((name): name is string => name !== undefined && name !== ''))];`,
);
