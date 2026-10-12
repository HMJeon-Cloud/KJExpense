// api/ai.js — 릴스 대표 카드용 글 설계(plan) · 이미지 글자 읽기(read) (v9.13)
// 주인 토큰(OWNER_KEY) 확인 후 OpenAI Responses API 호출. 키는 서버에만.
// 환경변수: OPENAI_API_KEY (필수) · TEXT_MODEL (기본 gpt-6.1-sol, 못 쓰면 gpt-4.1 로 다시 시도)
// POST { t, mode:"plan", facts:[{id,text}], purpose, topic, note }  → { ok, plan:{hook, sub, kicker, layout, points:[{label,value,note,fact}], cta, visual} }
// POST { t, mode:"read", image:"data:..." }                         → { ok, texts:[...] }   (카드 이미지에 실제로 찍힌 글자·숫자 받아 적기)
// POST { t, mode:"extract", text:"공고문 텍스트" }                   → { ok, terms:{res,resPeriod,prior,resale,live,rewin,firstRank,point,down,mid,balance,option,move,etc} } (v9.20.3 단지별 청약 조건)
const crypto = require("crypto");
function tokenOf(key) { return crypto.createHmac("sha256", key).update("trackapt-owner-v1").digest("hex"); }
function same(a, b) { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && crypto.timingSafeEqual(x, y); }

const PLAN_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["kicker", "hook", "sub", "layout", "points", "cta", "visual"],
  properties: {
    kicker: { type: "string", description: "맨 위 작은 말머리 (예: '10월 실거래', '디딤돌대출') 12자 이내" },
    hook: { type: "string", description: "3초 안에 궁금하게 만드는 큰 제목. 22자 이내. 숫자를 쓰면 facts 원문 그대로" },
    sub: { type: "string", description: "제목 아래 한 줄. 무엇을 알려 주는지. 32자 이내" },
    layout: { type: "string", enum: ["rank", "stat", "compare", "steps", "checklist"] },
    points: { type: "array", minItems: 3, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["label", "value", "note", "fact"],
      properties: {
        label: { type: "string", description: "항목 이름 (지역·단지·조건 등) 14자 이내" },
        value: { type: "string", description: "핵심 값. facts 원문의 숫자·날짜·단위를 한 글자도 바꾸지 말고 그대로 복사. 값이 없으면 짧은 핵심어" },
        note: { type: "string", description: "보조 설명 18자 이내 (숫자를 쓰면 facts 원문 그대로)" },
        fact: { type: "string", description: "근거 facts id (예: F3)" } } } },
    cta: { type: "string", description: "게시판으로 유도하는 한 줄. 예: '전체 순위·상세는 게시판에서'. 24자 이내" },
    visual: { type: "string", description: "배경 사진/일러스트 묘사(영어, 글자 없음). 주제에 맞는 장면" }
  }
};
const SYS = "너는 부동산 정보 SNS 채널 '우상향연구소(@uphill.lab)'의 릴스 표지 카드 편집자다. 목적: 한 장으로 핵심을 보여 주고, 상세 내용이 있는 게시판으로 유입시키는 것. " +
  "원칙: (1) 숫자·날짜·금액·퍼센트·단위는 반드시 제공된 facts 원문에서 그대로 복사한다. 반올림·환산·추정·새 숫자 금지. (2) facts에 없는 사실을 만들지 않는다. " +
  "(3) 3초 안에 흐름이 보이게: 궁금증을 유발하는 제목 → 3~5개 핵심 → 게시판 유도. 실생활에 도움이 되는 관점(내 돈, 내 동네, 내 대출)으로 쓴다. " +
  "(4) 투자 권유·과장·단정(무조건, 반드시 오른다 등) 금지. (5) 한국어, 짧고 쉬운 말. 이모지 금지.";

function extractText(j) {
  if (j.output_text) return j.output_text;
  const out = [];
  (j.output || []).forEach((o) => (o.content || []).forEach((c) => { if (c.type === "output_text" && c.text) out.push(c.text); }));
  return out.join("");
}
async function responses(key, model, input, format) {
  const body = { model, input };
  if (format) body.text = { format };
  const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ("OpenAI 응답 " + r.status));
  return extractText(j);
}
async function withFallback(key, input, format) {
  const want = process.env.TEXT_MODEL || "gpt-6.1-sol";
  try { return { text: await responses(key, want, input, format), model: want }; }
  catch (e) {
    if (want !== "gpt-4.1" && /model|not found|does not exist|access|unsupported/i.test(String(e.message))) return { text: await responses(key, "gpt-4.1", input, format), model: "gpt-4.1" };
    throw e;
  }
}
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const OWN = process.env.OWNER_KEY || "", KEY = process.env.OPENAI_API_KEY || "";
  if (req.method === "GET") return res.status(200).json({ ok: !!(OWN && KEY), model: process.env.TEXT_MODEL || "gpt-6.1-sol" });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (!OWN) return res.status(500).json({ ok: false, error: "OWNER_KEY not set" });
  if (!KEY) return res.status(500).json({ ok: false, error: "OPENAI_API_KEY 가 없습니다" });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
  if (!same(b.t, tokenOf(OWN))) return res.status(401).json({ ok: false, error: "주인 인증이 필요합니다" });
  try {
    if (b.mode === "plan") {
      const facts = (b.facts || []).slice(0, 80).map((f) => f.id + ": " + String(f.text).slice(0, 300)).join("\n");
      if (!facts) throw new Error("facts 가 비었습니다");
      const user = (b.note ? "[가장 중요한 요청] " + b.note + "\n" : "") + "주제: " + (b.topic || "") + "\n목적: " + (b.purpose || "게시판 상세 카드로 유입") + (b.note ? "\n추가 요청: " + b.note : "") +
        "\n\n[facts — 이 안의 숫자·날짜만 쓸 것]\n" + facts + "\n\n위 facts로 릴스 표지 한 장을 설계해 JSON으로 답하라. points.value 는 facts 원문을 그대로 복사.";
      /* 참고 이미지(선택): 모양·구성·분위기만 참고. 그 이미지 속 숫자·글자는 사실로 쓰지 않는다 */
      const refs = (b.refs || []).filter((u) => /^data:image\//.test(String(u))).slice(0, 3);
      const content = refs.length ? [{ type: "input_text", text: user + "\n\n[참고 이미지 " + refs.length + "장] 레이아웃·구성·톤만 참고하라(layout, visual 에 반영). 참고 이미지 안의 숫자·글자·사실은 절대 카드에 옮기지 말 것." }].concat(refs.map((u) => ({ type: "input_image", image_url: u }))) : user;
      const out = await withFallback(KEY, [{ role: "system", content: SYS }, { role: "user", content }], { type: "json_schema", name: "reel_card", strict: true, schema: PLAN_SCHEMA });
      return res.status(200).json({ ok: true, plan: JSON.parse(out.text), model: out.model });
    }
    if (b.mode === "read") {
      if (!/^data:image\//.test(String(b.image || ""))) throw new Error("이미지가 없습니다");
      const schema = { type: "object", additionalProperties: false, required: ["texts"], properties: { texts: { type: "array", items: { type: "string" } } } };
      const out = await withFallback(KEY, [{ role: "user", content: [
        { type: "input_text", text: "이 카드 이미지에 실제로 보이는 글자를 줄 단위로 빠짐없이 그대로 받아 적어라. 숫자·기호·단위는 보이는 그대로(고치거나 추측하지 말 것). 읽을 수 없는 글자는 □ 로 적어라." },
        { type: "input_image", image_url: b.image }] }], { type: "json_schema", name: "card_text", strict: true, schema });
      return res.status(200).json({ ok: true, texts: JSON.parse(out.text).texts || [], model: out.model });
    }
    if (b.mode === "extract") {   /* v9.20.3 입주자모집공고문 텍스트 → 단지별 청약 조건 (사실만, 없으면 빈칸) */
      var txt = String(b.text || "").slice(0, 60000); if (txt.length < 50) throw new Error("공고문 텍스트가 너무 짧습니다");
      var FIELDS = ["res", "resPeriod", "prior", "resale", "live", "rewin", "firstRank", "point", "down", "mid", "balance", "option", "move", "etc"];
      var props = {}; FIELDS.forEach(function (k) { props[k] = { type: "string" }; });
      var schema = { type: "object", additionalProperties: false, required: FIELDS, properties: props };
      var guide = "너는 입주자모집공고문에서 청약 조건을 '있는 그대로' 뽑아 적는 사람이다. 공고문에 없는 내용은 빈 문자열로 둔다. 추측·일반 규칙 보충 금지. 각 항목은 한국어 한 줄(40자 이내), 공고문의 숫자·기간·지역명 그대로.\n" +
        "res: 신청 자격 거주지 요건(예: '서울특별시 거주자' / '수도권 거주자') · resPeriod: 거주 기간 요건(예: '공고일 기준 2년 이상') · prior: 지역 우선 공급 비율·순서(예: '해당지역 50% → 경기 20% → 수도권 30%') · resale: 전매 제한(예: '당첨자 발표일부터 3년') · live: 실거주 의무(예: '최초 입주 가능일부터 2년') · rewin: 재당첨 제한 · firstRank: 1순위 요건(통장 기간·예치금·세대주·주택 수) · point: 가점제/추첨제 비율 · down: 계약금(비율·납부일) · mid: 중도금(비율·회차·대출 알선 여부) · balance: 잔금 · option: 발코니 확장·옵션 비용 요약 · move: 입주 예정 시기 · etc: 그 밖에 신청 전 꼭 알아야 할 특이 조건(예: '중복 청약 불가', '부적격 시 1년 제한').";
      var out = await withFallback(KEY, [{ role: "system", content: guide }, { role: "user", content: "[공고문 텍스트]\n" + txt + "\n\n위 공고문에서 항목별 조건을 JSON으로 답하라. 없으면 빈 문자열." }], { type: "json_schema", name: "notice_terms", strict: true, schema: schema });
      return res.status(200).json({ ok: true, terms: JSON.parse(out.text), model: out.model });
    }
    throw new Error("mode 는 plan · read · extract");
  } catch (e) { return res.status(502).json({ ok: false, error: String(e && e.message || e).slice(0, 300) }); }
};
