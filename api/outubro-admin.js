const crypto = require('crypto');
const { json } = require('./_utils');
const store = require('./_outubro-store');

const ADMIN_SALT = '81a45b88b10c69a9a55ca02898e1dc24';
const ADMIN_HASH = '55856c8bd93eb51cd61bc68236562c88d1f6ecc1065d8bfab7b38b702e572fae';

function validPassword(password){
  try{
    const derived=crypto.scryptSync(String(password||''),Buffer.from(ADMIN_SALT,'hex'),32,{N:16384,r:8,p:1});
    const expected=Buffer.from(ADMIN_HASH,'hex');
    return derived.length===expected.length&&crypto.timingSafeEqual(derived,expected);
  }catch{return false}
}
function cors(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return true}
  return false;
}

module.exports = async function handler(req,res){
  if(cors(req,res)) return;
  if(req.method!=='POST') return json(res,405,{ok:false,error:'Método não permitido.'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});
    if(!validPassword(body.password)) return json(res,401,{ok:false,error:'Senha incorreta.'});
    const action=String(body.action||'list');
    if(action==='confirm') await store.updateStatus(body.reservationId,'confirmed');
    else if(action==='cancel') await store.updateStatus(body.reservationId,'cancelled');
    else if(action==='removeParticipant') await store.removeParticipant(body.reservationId,body.participantId);
    const data=await store.adminData();
    return json(res,200,{ok:true,...data});
  }catch(error){
    console.error(error);
    return json(res,500,{ok:false,error:error.message||'Erro interno.'});
  }
};