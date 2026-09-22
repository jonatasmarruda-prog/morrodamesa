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
      const data=await store.stats();
      return json(res,200,{ok:true,...data});
    }
    if(req.method==='POST'){
      const body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});
      const reservation=await store.createReservation(body);
      const stats=await store.stats();
      return json(res,200,{ok:true,reservation,stats});
    }
    return json(res,405,{ok:false,error:'Método não permitido.'});
  }catch(error){
    console.error(error);
    return json(res,500,{ok:false,error:error.message||'Erro interno.'});
  }
};