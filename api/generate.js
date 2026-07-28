/**
 * Vercel serverless endpoint for the Study Manager app.
 * Environment variables: NEIS_API_KEY, GEMINI_API_KEY. They never reach the browser.
 */
const NEIS_BASE = 'https://open.neis.go.kr/hub';

function normalizeRows(payload, key) {
  const group = payload[key];
  return Array.isArray(group) && Array.isArray(group[1]?.row) ? group[1].row : [];
}

async function neis(path, params) {
  if (!process.env.NEIS_API_KEY) throw new Error('NEIS_API_KEY 환경변수가 설정되지 않았습니다.');
  const url = new URL(`${NEIS_BASE}/${path}`);
  url.search = new URLSearchParams({KEY:process.env.NEIS_API_KEY,Type:'json',pIndex:'1',pSize:'100',...params});
  const response = await fetch(url);
  if (!response.ok) throw new Error('NEIS 서버 요청에 실패했습니다.');
  return response.json();
}

function dateFromNeis(value) { return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`; }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'POST 요청만 허용됩니다.'});
  try {
    const {action, schoolName, school, file} = req.body || {};
    if (action === 'schools') {
      const data = await neis('schoolInfo', {SCHUL_NM:schoolName});
      const rows = normalizeRows(data, 'schoolInfo');
      return res.status(200).json({schools:rows.map(r=>({name:r.SCHUL_NM,code:r.SD_SCHUL_CODE,officeCode:r.ATPT_OFCDC_SC_CODE,address:r.ORG_RDNMA}))});
    }
    if (action === 'schedule') {
      if (!school?.code || !school?.officeCode) throw new Error('학교를 먼저 선택하세요.');
      const year = new Date().getFullYear();
      const data = await neis('SchoolSchedule', {ATPT_OFCDC_SC_CODE:school.officeCode,SD_SCHUL_CODE:school.code,AA_FROM_YMD:`${year}0101`,AA_TO_YMD:`${year}1231`});
      const rows = normalizeRows(data, 'SchoolSchedule');
      const now = new Date(); now.setHours(0,0,0,0);
      const exams = rows.filter(r=>/시험|고사|중간|기말/.test(`${r.EVENT_NM||''} ${r.SBTR_DD_SC_NM||''}`)).map(r=>{const date=dateFromNeis(r.AA_YMD);return {id:`${r.AA_YMD}-${r.EVENT_NM}`,name:r.EVENT_NM,date,dday:Math.ceil((new Date(`${date}T00:00:00`)-now)/86400000)};}).sort((a,b)=>a.date.localeCompare(b.date));
      return res.status(200).json({exams});
    }
    if (action === 'analyze') {
      if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
      if (!file?.data) throw new Error('분석할 파일이 없습니다.');
      const match=file.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error('지원하지 않는 파일 형식입니다.');
      const prompt='Analyze this Korean study problem. Return ONLY valid JSON with Korean values and fields: subject, unit, difficulty (상|중|하), summary, tags (array max 5), priority (높음|중간|낮음).';
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt},{inlineData:{mimeType:match[1],data:match[2]}}]}],generationConfig:{responseMimeType:'application/json'}})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message||'Gemini 요청에 실패했습니다.');
      return res.status(200).json({analysis:JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text||'{}')});
    }
    return res.status(400).json({error:'알 수 없는 action입니다.'});
  } catch (error) { return res.status(500).json({error:error.message||'서버 오류가 발생했습니다.'}); }
}
