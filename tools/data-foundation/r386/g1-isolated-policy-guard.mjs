// G1 policy candidate. Synthetic/isolated-only. NO live runtime import.
// The trusted resolver must authenticate the NOOR session, check revocation,
// account permission, deletion status and owner non-reuse against its authority.
import {executeReceiptCandidate} from './receipt-bridge.mjs';
import {validIdentifier,validReceiptToken} from './legacy-event-contract.mjs';
const deny=code=>{throw new Error(code)};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));

export function verifyG1HistoricalKeyCoverage({keys,activeKeyId,requiredKeyIds}){
 if(!(keys instanceof Map)||keys.size<1||keys.size>8||!validReceiptToken(activeKeyId)||
    !(requiredKeyIds instanceof Set)||!keys.has(activeKeyId))deny('R386_G1_KEY_POLICY');
 for(const [id,key] of keys){
  if(!validReceiptToken(id)||!Buffer.isBuffer(key)||key.length<32)deny('R386_G1_KEY_POLICY');
 }
 for(const id of requiredKeyIds){
  if(!validReceiptToken(id)||!keys.has(id))deny('R386_G1_HISTORICAL_KEY_REQUIRED');
 }
 return true;
}

export async function executeG1IsolatedAuthorizedCommand({request,verifySession,loadHistoricalReceiptKeyIds,keys,activeKeyId,adapter,evaluate,nowEpochMs}){
 // Only a verified NOOR session may supply the owner; HTTP callers cannot.
 if(!plain(request)||Object.keys(request).sort().join(',')!=='command,requestId,sessionId'||
    !validReceiptToken(request.requestId)||!validReceiptToken(request.sessionId)||
    !plain(request.command)||typeof verifySession!=='function'||typeof loadHistoricalReceiptKeyIds!=='function'||
    !Number.isSafeInteger(nowEpochMs)||nowEpochMs<0)deny('R386_G1_REQUEST');
 verifyG1HistoricalKeyCoverage({keys,activeKeyId,requiredKeyIds:new Set()});
 let principal;
 try{principal=await verifySession(request.sessionId);}catch{deny('R386_G1_SESSION_UNAVAILABLE')}
 if(!plain(principal)||!validIdentifier(principal.ownerId)||!validIdentifier(principal.accountId)||
    principal.active!==true||principal.revoked!==false||principal.erased!==false||
    principal.authorizedPersonal!==true||principal.ownerEverReassigned!==false||
    !Number.isSafeInteger(principal.expiresAtEpochMs)||principal.expiresAtEpochMs<=nowEpochMs)
  deny('R386_G1_PRINCIPAL_DENIED');
 let requiredKeyIds;
 try{requiredKeyIds=await loadHistoricalReceiptKeyIds(principal.ownerId);}
 catch{deny('R386_G1_KEY_INVENTORY_UNAVAILABLE')}
 verifyG1HistoricalKeyCoverage({keys,activeKeyId,requiredKeyIds});
 return executeReceiptCandidate({owner:principal.ownerId,requestId:request.requestId,
  command:request.command,activeKeyId,keys,adapter,evaluate});
}

// Evidence checker only. Caller must prove these facts from independent,
// authoritative stores; these flags do not perform the deletion themselves.
export function assertG1IrreversibleErasureEvidence(evidence){
 if(!plain(evidence)||Object.keys(evidence).sort().join(',')!==
  'candidateErased,linkageRemoved,noorSessionsRevoked,ownerNeverReissued,sourceErased,verifiedAuthority'||
  !Object.values(evidence).every(v=>v===true))deny('R386_G1_ERASURE_INCOMPLETE');
 return true;
}
