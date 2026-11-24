import {readFileSync} from 'node:fs';

/** A version closure for the bundled Windows MCP roots, not a wheel hash lock. */
export function validatePythonConstraints(text,seeds){
 const pins=new Map();
 for(const line of text.split(/\r?\n/)){
  const value=line.trim();if(!value||value.startsWith('#'))continue;
  const match=/^([A-Za-z0-9][A-Za-z0-9._-]*)==([0-9][A-Za-z0-9.+!_-]*)$/.exec(value);
  if(!match)throw Error('Python constraints must contain exact versions only: '+value);
  const name=match[1].toLowerCase().replace(/[-_.]+/g,'-');
  if(pins.has(name))throw Error('Duplicate Python constraint: '+name);
  pins.set(name,match[2]);
 }
 if(!pins.size)throw Error('Python dependency constraints are empty');
 for(const seed of seeds){
  const name=seed.package.toLowerCase().replace(/[-_.]+/g,'-');
  if(pins.get(name)!==seed.version)throw Error('Python seed pin is missing or stale: '+seed.package+'=='+seed.version);
 }
 return pins;
}

export function readPythonConstraints(file,seeds){return validatePythonConstraints(readFileSync(file,'utf8'),seeds);}
