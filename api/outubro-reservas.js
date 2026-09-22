const { json } = require('./_utils');
const store = require('./_outubro-store');

function cors(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return true}
  return false;
}

module.exports = async function handler(req,res){
  if(cors(req,res)) return;
  try{
    if(req.method==='GET'){
      const reservationId=String(req.query?.reservation||'').trim();
      if(reservationId){
        const reservation=await store.reservationById(reservationId);
        if(!reservation) return json(res,404,{ok:false,error:'Reserva não encontrada.'});
        res.setHeader('Cache-Control','no-store, max-age=0');
        return json(res,200,{ok:true,reservation});
      }

      const data=await store.stats();
      res.statusCode=200;
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.setHeader('Cache-Control','public, max-age=0, s-maxage=2, stale-while-revalidate=2');
      return res.end(JSON.stringify({ok:true,...data,updatedAt:new Date().toISOString()}));
    }

    if(req.method==='POST'){
      const body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});
      const result=await store.startCheckout({
        clientId:body.clientId,
        participants:body.participants,
        paymentMethod:body.paymentMethod,
        returnBaseUrl:body.returnBaseUrl
      });
      const stats=await store.stats();
      return json(res,200,{ok:true,...result,stats});
    }

    return json(res,405,{ok:false,error:'Método não permitido.'});
  }catch(error){
    console.error(error);
    const msg=error.message||'Erro interno.';
    const status=/esgotadas|suficientes|últimas vagas/i.test(msg)?409:500;
    return json(res,status,{ok:false,error:msg});
  }
};