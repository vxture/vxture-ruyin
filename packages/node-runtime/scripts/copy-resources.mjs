/**
 * Pack the canonical reader without maintaining a second source.
 * @package @vxture/ruyin-node-runtime
 * @layer Infrastructure
 * @category Build
 * @author AI-Generated
 * @date 2026-11-25
 */
import {copyFileSync,mkdirSync} from 'node:fs';
const target=new URL('../dist/',import.meta.url);
mkdirSync(target,{recursive:true});
for(const [source,name] of [['reader.py','document-reader.py'],['requirements.lock','requirements.lock']]){
 copyFileSync(new URL('../../../resources/document-reader/'+source,import.meta.url),new URL(name,target));
}
