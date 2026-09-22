const { json } = require('./_utils');
const store = require('./_outubro-store');

function cors(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return true}
  return false;
}

module.exports=async function handler(req,res){
  if(cors(req,res)) return;
  if(req.method!=='GET') return json(res,405,{ok:false,error:'Método não permitido.'});
  try{
    const id=String(req.query?.reserva||req.query?.reservation||'').trim();
    if(!/^OR-2026-[A-F0-9]{12}$/.test(id)) return json(res,400,{ok:false,error:'Reserva inválida.'});
    const reservation=await store.reservationById(id);
    if(!reservation) return json(res,404,{ok:false,error:'Reserva não encontrada.'});
    return json(res,200,{ok:true,reservation:{
      id:reservation.id,status:reservation.status,quantity:reservation.quantity,total:reservation.total,
      paymentMethod:reservation.paymentMethod,approvedAt:reservation.approvedAt,expiresAt:reservation.expiresAt
    }});
  }catch(error){
    console.error(error);
    return json(res,500,{ok:false,error:'Não foi possível consultar o pagamento.'});
  }
};