/** Public display metadata only; never receives account or session credentials. */
export class ProductDisplayMetadata {
  private cached?: {until:number;rows:Map<string,Record<string,unknown>>};
  constructor(private readonly websiteBase:string,private readonly consoleBase:string){}
  private async readCatalog():Promise<Map<string,Record<string,unknown>>>{
    if(this.cached&&this.cached.until>=Date.now())return this.cached.rows;
    const response=await fetch(new URL("/api/products/catalog",this.websiteBase),{
      headers:{accept:"application/json"},credentials:"omit",signal:AbortSignal.timeout(5000),redirect:"error",
    });
    if(!response.ok)throw Error("catalog unavailable");
    const body=await response.text();if(body.length>1024*1024)throw Error("catalog too large");
    const data:unknown=JSON.parse(body);if(!Array.isArray(data))throw Error("invalid catalog");
    const catalog=new Map(data.filter((item):item is Record<string,unknown>=>!!item&&typeof item==="object"&&typeof item.productCode==="string")
      .map(item=>[item.productCode as string,item]));
    this.cached={until:Date.now()+60_000,rows:catalog};return catalog;
  }
  async catalog(){
    const rows=await this.readCatalog();
    return [...rows.values()].filter(row=>typeof row.productName==="string"&&typeof row.productType==="string").map(row=>({
      productCode:String(row.productCode),productName:String(row.productName),productType:String(row.productType),
      productNick:typeof row.productNick==="string"?row.productNick:null,
      description:typeof row.description==="string"?row.description.slice(0,10000):null,
      iconUrl:typeof row.iconUrl==="string"?row.iconUrl:null,iconVersion:typeof row.iconVersion==="string"?row.iconVersion:null,
      releaseVersion:typeof row.releaseVersion==="string"?row.releaseVersion:null,
      releaseStage:typeof row.releaseStage==="string"?row.releaseStage:null,
    }));
  }
  async enrich(rows:unknown[]):Promise<unknown[]> {
    let catalog=this.cached?.rows;
    try{catalog=await this.readCatalog();}catch{/* Display lookup cannot erase or deny valid subscriptions. */}
    return rows.map(item=>{
      if(!item||typeof item!=="object")return item;
      const row=item as Record<string,unknown>;if(typeof row.productCode!=="string")return item;
      const meta=catalog?.get(row.productCode),version=row.iconVersion;
      const icon=typeof version==="string"&&version
        ?new URL(`/api/applications/${encodeURIComponent(row.productCode)}/icon?v=${encodeURIComponent(version)}`,this.consoleBase).href
        :row.iconUrl??meta?.iconUrl;
      return {...row,...(typeof meta?.description==="string"?{description:meta.description.slice(0,10000)}:{}),
        ...(typeof meta?.productNick==="string"?{productNick:meta.productNick}:{}),
        ...(typeof meta?.releaseStage==="string"?{releaseStage:meta.releaseStage}:{}),
        ...(typeof icon==="string"?{iconUrl:icon}:{})};
    });
  }
}
