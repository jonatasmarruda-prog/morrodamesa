const SHEET_ID = '1EwRf2UagY_qu7mJ0bbX2RxUbCLqOjZ_jXrO2lh0IZlY';
const TOTAL_VAGAS = 100;
const PRICE_ENTRY = 30;
const PRICE_SHIRT = 75;
const DEFAULT_TTL_MIN = 60;

function doGet(e){
  try{
    const action=(e.parameter.action||'health').trim();
    if(action==='health') return json_({ok:true,service:'Outubro Rosa API'});
    if(action==='stats') return json_({ok:true,...stats_()});
    return json_({ok:false,error:'Ação inválida.'});
  }catch(err){return json_({ok:false,error:String(err.message||err)})}
}

function doPost(e){
  try{
    setup_();
    const body=JSON.parse((e.postData&&e.postData.contents)||'{}');
    const action=body.action||'';
    if(action==='createReservation') return json_(createReservation_(body));
    if(action==='adminList'){auth_(body.password);return json_(adminList_())}
    if(action==='confirmReservation'){auth_(body.password);return json_(setReservationStatus_(body.reservationId,'CONFIRMADA'))}
    if(action==='cancelReservation'){auth_(body.password);return json_(setReservationStatus_(body.reservationId,'CANCELADA'))}
    if(action==='cancelParticipant'){auth_(body.password);return json_(cancelParticipant_(body.reservationId,body.participantId))}
    return json_({ok:false,error:'Ação inválida.'});
  }catch(err){return json_({ok:false,error:String(err.message||err)})}
}

function setup_(){
  const ss=SpreadsheetApp.openById(SHEET_ID);
  ensureSheet_(ss,'OR_Reservas',['ID','CriadaEm','ExpiraEm','WhatsApp','Quantidade','Total','Pagamento','Status']);
  ensureSheet_(ss,'OR_Participantes',['IDReserva','IDParticipante','Nome','Opcao','Modelo','Tamanho','Valor','Status']);
  ensureSheet_(ss,'OR_Camisetas',['IDReserva','IDParticipante','Nome','TipoCamiseta','Tamanho','Quantidade','Status','DataHora']);
}

function ensureSheet_(ss,name,headers){
  let sh=ss.getSheetByName(name);
  if(!sh){sh=ss.insertSheet(name);sh.getRange(1,1,1,headers.length).setValues([headers]);sh.setFrozenRows(1)}
  return sh;
}

function sheets_(){
  const ss=SpreadsheetApp.openById(SHEET_ID);
  return {ss,res:ss.getSheetByName('OR_Reservas'),part:ss.getSheetByName('OR_Participantes'),shirts:ss.getSheetByName('OR_Camisetas')};
}

function createReservation_(body){
  setup_();
  const lock=LockService.getScriptLock(); lock.waitLock(20000);
  try{
    cleanupExpired_();
    const participants=Array.isArray(body.participants)?body.participants:[];
    if(participants.length<1||participants.length>10) throw new Error('Escolha de 1 a 10 participantes.');
    participants.forEach((p,i)=>{
      if(!String(p.name||'').trim()) throw new Error('Nome obrigatório na participante '+(i+1)+'.');
      if(!['entry','shirt'].includes(p.option)) throw new Error('Opção inválida.');
      if(p.option==='shirt'&&!['Camiseta Tradicional','Babylook'].includes(p.model)) throw new Error('Modelo de camiseta inválido.');
      if(p.option==='shirt'&&!['PP','P','M','G','GG'].includes(p.size)) throw new Error('Tamanho inválido.');
    });
    const st=stats_();
    if(participants.length>st.available) throw new Error('Não há vagas suficientes disponíveis.');
    const id='OR-2026-'+Utilities.formatString('%06d',nextSequence_());
    const now=new Date();
    const ttl=Number(PropertiesService.getScriptProperties().getProperty('RESERVATION_TTL_MINUTES')||DEFAULT_TTL_MIN);
    const expires=new Date(now.getTime()+ttl*60000);
    const total=participants.reduce((s,p)=>s+(p.option==='shirt'?PRICE_SHIRT:PRICE_ENTRY),0);
    const sh=sheets_();
    sh.res.appendRow([id,now,expires,String(body.whatsapp||''),participants.length,total,String(body.paymentMethod||'PIX').toUpperCase(),'AGUARDANDO_PAGAMENTO']);
    participants.forEach((p,i)=>{
      const pid=id+'-P'+(i+1);
      const price=p.option==='shirt'?PRICE_SHIRT:PRICE_ENTRY;
      sh.part.appendRow([id,pid,String(p.name).trim(),p.option,p.model||'',p.size||'',price,'ATIVA']);
      if(p.option==='shirt') sh.shirts.appendRow([id,pid,String(p.name).trim(),p.model,p.size,1,'ATIVA',now]);
    });
    return {ok:true,reservation:{id,quantity:participants.length,total,status:'AGUARDANDO_PAGAMENTO',expiresAt:expires.toISOString()}};
  }finally{lock.releaseLock()}
}

function stats_(){
  setup_(); cleanupExpired_();
  const sh=sheets_().res, values=rows_(sh);
  let confirmed=0,pending=0;
  values.forEach(r=>{
    const qty=Number(r[4]||0),status=String(r[7]||'');
    if(status==='CONFIRMADA') confirmed+=qty;
    else if(status==='AGUARDANDO_PAGAMENTO'||status==='AGUARDANDO_CONFERENCIA') pending+=qty;
  });
  const reserved=confirmed+pending;
  return {total:TOTAL_VAGAS,confirmed,pending,reserved,available:Math.max(0,TOTAL_VAGAS-reserved)};
}

function cleanupExpired_(){
  const ss=SpreadsheetApp.openById(SHEET_ID),res=ss.getSheetByName('OR_Reservas');
  if(!res||res.getLastRow()<2)return;
  const vals=res.getRange(2,1,res.getLastRow()-1,8).getValues(),now=new Date();
  vals.forEach((r,i)=>{
    if(String(r[7])==='AGUARDANDO_PAGAMENTO'&&r[2] instanceof Date&&r[2]<now){
      res.getRange(i+2,8).setValue('EXPIRADA');
      setChildStatus_(String(r[0]),'EXPIRADA');
    }
  });
}

function setReservationStatus_(id,status){
  const sh=sheets_(), row=findRow_(sh.res,1,id);
  if(!row) throw new Error('Reserva não encontrada.');
  sh.res.getRange(row,8).setValue(status);
  setChildStatus_(id,status==='CONFIRMADA'?'CONFIRMADA':status);
  return {ok:true,id,status,...stats_()};
}

function cancelParticipant_(reservationId,participantId){
  const sh=sheets_(),prow=findRow_(sh.part,2,participantId);
  if(!prow) throw new Error('Participante não encontrada.');
  sh.part.getRange(prow,8).setValue('CANCELADA');
  const srow=findRow_(sh.shirts,2,participantId);if(srow)sh.shirts.getRange(srow,7).setValue('CANCELADA');
  const active=rows_(sh.part).filter(r=>String(r[0])===reservationId&&String(r[7])!=='CANCELADA'&&String(r[7])!=='EXPIRADA');
  const rrow=findRow_(sh.res,1,reservationId);if(!rrow)throw new Error('Reserva não encontrada.');
  const total=active.reduce((s,r)=>s+Number(r[6]||0),0);
  sh.res.getRange(rrow,5).setValue(active.length);sh.res.getRange(rrow,6).setValue(total);
  if(active.length===0) sh.res.getRange(rrow,8).setValue('CANCELADA');
  return {ok:true,...stats_()};
}

function setChildStatus_(reservationId,status){
  const sh=sheets_();
  updateMatching_(sh.part,1,reservationId,8,status);
  updateMatching_(sh.shirts,1,reservationId,7,status);
}

function adminList_(){
  const sh=sheets_(),resRows=rows_(sh.res),partRows=rows_(sh.part);
  const reservations=resRows.filter(r=>String(r[7])!=='CANCELADA'&&String(r[7])!=='EXPIRADA').map(r=>{
    const id=String(r[0]);
    return {id,createdAt:r[1],whatsapp:String(r[3]||''),quantity:Number(r[4]||0),total:Number(r[5]||0),paymentMethod:String(r[6]||''),status:String(r[7]||''),participants:partRows.filter(p=>String(p[0])===id&&String(p[7])!=='CANCELADA').map(p=>({id:String(p[1]),name:String(p[2]),option:String(p[3]),model:String(p[4]),size:String(p[5]),price:Number(p[6]||0),status:String(p[7])}))};
  }).reverse();
  return {ok:true,stats:stats_(),reservations};
}

function auth_(password){
  const expected=PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if(!expected) throw new Error('Senha administrativa ainda não configurada no Apps Script.');
  if(String(password||'')!==expected) throw new Error('Senha administrativa incorreta.');
}

function nextSequence_(){
  const p=PropertiesService.getScriptProperties(),n=Number(p.getProperty('RESERVATION_SEQUENCE')||0)+1;p.setProperty('RESERVATION_SEQUENCE',String(n));return n;
}

function rows_(sh){return !sh||sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues()}
function findRow_(sh,col,val){if(!sh||sh.getLastRow()<2)return 0;const a=sh.getRange(2,col,sh.getLastRow()-1,1).getValues();for(let i=0;i<a.length;i++)if(String(a[i][0])===String(val))return i+2;return 0}
function updateMatching_(sh,col,val,statusCol,status){if(!sh||sh.getLastRow()<2)return;const a=sh.getRange(2,col,sh.getLastRow()-1,1).getValues();a.forEach((r,i)=>{if(String(r[0])===String(val))sh.getRange(i+2,statusCol).setValue(status)})}
function json_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
