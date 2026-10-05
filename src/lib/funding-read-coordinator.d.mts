export interface FundingControl { hash:string|null; value:null|{version:number;dataset_sha256:string;revision:string;previous_sha256:string|null}; }
export interface FundingSnapshot { control:FundingControl; }
export interface FundingHead { hash:string;value:Exclude<FundingControl['value'],null>; }
export class FundingReadError extends Error { code:string; }
export const COMMITTED_HEAD_SQL:string;
export function parseCommittedHead(result:unknown):FundingHead|null;
export function committedHead(query:(text:string,params:string[])=>Promise<unknown>):Promise<FundingHead|null>;
export function createFundingReadCoordinator<T extends FundingSnapshot>(deps:{readHead:()=>Promise<FundingHead|null>;readLocal:()=>T;refresh:()=>Promise<unknown>;recoveryReady:()=>boolean}):{read:()=>Promise<T>;diagnostics:()=>{reads:number;refreshes:number;refusals:number;active:boolean}};
