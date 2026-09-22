const { json, mercadoPagoTokenMode } = require('./_utils');
const store = require('./_outubro-store');

function cors(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return true}
  return false;
}

module.exports=async function handler(req,res){
  if(cors(req,res)) return;
  if(req.method!=='POST') return json(res,405,{ok:false,error:'Método não permitido.'});
  try{
    if(mercadoPagoTokenMode()!=='production') return json(res,503,{ok:false,error:'Pagamento automático ainda não está em modo de produção.'});
    const body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});
    const result=await store.startCheckout({
      clientId:body.clientId,
      participants:body.participants,
      paymentMethod:body.paymentMethod,
      returnBaseUrl:'https://jonatasmarruda-prog.github.io/morrodamesa/outubro-rosa-2026/'
    });
    return json(res,200,{ok:true,...result});
  }catch(error){
    console.error(error);
    const msg=error.message||'Não foi possível iniciar o pagamento.';
    const code=/esgotad|vagas|preenchidas/i.test(msg)?409:500;
    return json(res,code,{ok:false,error:msg});
  }
};