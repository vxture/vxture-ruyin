/**
 * Original Node runtime adapter shared by native and product server hosts.
 * @package @vxture/ruyin-node-runtime
 * @layer Infrastructure
 * @category Runtime
 * @author AI-Generated
 * @date 2026-11-25
 */
/** Single saved-file handoffs for browser navigation, never general API credentials. */
import {randomBytes} from 'node:crypto';
export const RENDER_DOWNLOAD_TTL_MS=60000;
export interface RenderDownloadScope {projectId:string;productId:string;renderId:string;format:'md'|'docx'|'pdf';bridgeToken:string}
export class RenderDownloads {
 private tickets=new Map<string,RenderDownloadScope&{expiresAt:number}>();
 issue(scope:RenderDownloadScope,now=Date.now()){
  this.sweep(now);if(this.tickets.size>=128)throw Error('Too many pending downloads; retry shortly');
  const ticket=randomBytes(32).toString('hex'),expiresAt=now+RENDER_DOWNLOAD_TTL_MS;
  this.tickets.set(ticket,{...scope,expiresAt});return {path:'/downloads/'+ticket,expiresAt};
 }
 consume(ticket:string,now=Date.now()){
  this.sweep(now);const value=this.tickets.get(ticket);this.tickets.delete(ticket);return value;
 }
 private sweep(now:number){for(const [key,value]of this.tickets)if(value.expiresAt<=now)this.tickets.delete(key);}
}
export function renderFilename(title:string,format:string){
 const name=title.slice(0,120).replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_');
 let end=name.length;while(end>0&&(name[end-1]==='.'||name[end-1]===' '))end--;
 return (name.slice(0,end)||'deliverable')+'.'+format;
}
export function attachmentDisposition(filename:string){return `attachment; filename="deliverable.${filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`;}
