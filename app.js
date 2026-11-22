const BANDS = {
  "Poppin'Party": "#ff3377", "Roselia": "#5a3fd1", "RAISE A SUILEN": "#20b2aa", "Morfonica": "#33aaff",
  "MyGO!!!!!": "#3388bb", "Ave Mujica": "#9b1d3a", "夢限大みゅーたいぷ": "#ff8a1f", "millsage": "#7b8e3a", "一家Dumb Rock!": "#c9a100",
  "Afterglow": "#e8483a", "Pastel＊Palettes": "#f582ae", "ハロー、ハッピーワールド！": "#ffc61a"
};
const OTHER = "#8a7a93";
const KINDS = [["단독", "단독 라이브"], ["투어", "투어"], ["합동", "합동"], ["출연", "페스·출연"], ["이벤트", "이벤트"]];
const WD = ["일", "월", "화", "수", "목", "금", "토"];

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const today = new Date(); today.setHours(0, 0, 0, 0);
const md = d => `${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`;
const color = b => BANDS[b] || OTHER;

let EVENTS = [];
let active = null, activeKind = null, showPast = false;
try { active = localStorage.getItem("bandori-filter") || null; activeKind = localStorage.getItem("bandori-kind") || null; } catch (e) {}
const save = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };

const lastDate = e => parse(e.stops[e.stops.length - 1].end || e.stops[e.stops.length - 1].date);
const firstUpcoming = e => {
  for (const s of e.stops) {
    const d = parse(s.date), end = s.end ? parse(s.end) : d;
    if (end >= today) return d < today ? today : d;
  }
  return null;
};
const match = e => (!active || e.bands.includes(active)) && (!activeKind || e.kind === activeKind);
const visible = e => showPast || lastDate(e) >= today;

// "TOYOTA ARENA TOKYO（韓国）" -> query without trailing country note
const place = v => v.replace(/[（(][^）)]*[）)]\s*$/, "").trim() || v;
const mapA = v => v ? `<a class="map" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place(v))}" target="_blank" rel="noopener" aria-label="${esc(v)} 구글 지도">지도</a>` : "";
const venueHtml = v => v ? `<span class="venue">${esc(v)}${mapA(v)}</span>` : "";

function priceHtml(e) {
  const p = e.prices || [];
  if (!p.length) return `<div class="price none">표 가격: 공식 페이지에 아직 없음</div>`;
  const nums = p.map(x => (x[1].match(/([0-9][0-9,]*)\s*円/) || [])[1]).filter(Boolean).map(n => parseInt(n.replace(/,/g, ""), 10));
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const summary = nums.length ? (lo === hi ? `${lo.toLocaleString()}円` : `${lo.toLocaleString()}円 ~ ${hi.toLocaleString()}円`) : esc(p[0][1]);
  return `<details class="price"><summary>표 가격 <b>${summary}</b></summary>
    <ul>${p.map(x => `<li><span>${esc(x[0]) || "가격"}</span><span>${esc(x[1])}</span></li>`).join("")}</ul></details>`;
}

function chip(label, pressed, onClick, c) {
  const b = document.createElement("button");
  b.className = "chip" + (c ? "" : " kind"); b.type = "button";
  b.setAttribute("aria-pressed", String(pressed));
  if (c) b.style.setProperty("--c", c);
  b.innerHTML = (c ? "<i></i>" : "") + esc(label);
  b.onclick = onClick;
  return b;
}

function renderFilters() {
  const kinds = document.getElementById("kinds"); kinds.innerHTML = "";
  kinds.appendChild(chip("모든 공연", activeKind === null, () => { activeKind = null; save("bandori-kind", null); render(); }));
  for (const [k, label] of KINDS) {
    const n = EVENTS.filter(e => e.kind === k && visible(e)).length;
    if (!n && activeKind !== k) continue;
    kinds.appendChild(chip(`${label} ${n}`, activeKind === k, () => { activeKind = k; save("bandori-kind", k); render(); }));
  }
  const box = document.getElementById("filters"); box.innerHTML = "";
  const all = chip("전체", active === null, () => { active = null; save("bandori-filter", null); render(); });
  all.classList.remove("kind"); box.appendChild(all);
  const bands = [...new Set(EVENTS.filter(visible).flatMap(e => e.bands))];
  bands.sort((a, b) => (Object.keys(BANDS).indexOf(a) + 1 || 99) - (Object.keys(BANDS).indexOf(b) + 1 || 99));
  for (const n of bands) box.appendChild(chip(n, active === n, () => { active = n; save("bandori-filter", n); render(); }, color(n)));
}

function card(e) {
  const first = firstUpcoming(e) || parse(e.stops[0].date);
  const el = document.createElement("article");
  el.className = "ev" + (lastDate(e) < today ? " past" : "");
  el.style.setProperty("--c", color(e.bands[0]));
  const venues = [...new Set(e.stops.map(s => s.venue).filter(Boolean))];
  const range = e.stops.length === 1 && e.stops[0].end;
  const single = e.stops.length === 1 || (venues.length <= 1 && !e.venue_note);
  const dateLine = range ? `${md(parse(e.stops[0].date))} ~ ${md(parse(e.stops[0].end))}` :
    (single && e.stops.length > 1 ? e.stops.map(s => md(parse(s.date))).join(" · ") : "");
  const stops = single ? "" :
    `<ul class="stops">${e.stops.map(s => `<li><span>${md(parse(s.date))}</span>${s.venue ? venueHtml(s.venue) : "<span></span>"}</li>`).join("")}</ul>`;
  el.innerHTML = `
    <div class="stub"><div class="day">${first.getMonth() + 1}/${first.getDate()}</div><div class="wd">${WD[first.getDay()]}요일</div>
      ${e.stops.length > 1 ? `<div class="more">총 ${e.stops.length}회</div>` : ""}</div>
    <div class="body">
      <a class="title" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>
      <div class="meta"><span class="tag">${esc(e.kind)}</span>
        ${e.bands.map(b => `<span class="band" style="--c:${color(b)}">${esc(b)}</span>`).join("")}
        ${dateLine ? `<span>${dateLine}</span>` : ""}
        ${single ? venueHtml(venues[0]) : ""}
      </div>
      ${stops}
      ${e.venue_note ? `<div class="meta">${e.venues.map(venueHtml).join("")}</div><div class="note">날짜와 장소 수가 달라 날짜별 장소는 공식 페이지에서 확인</div>` : ""}
      ${e.summary ? `<div class="note">${esc(e.summary)}</div>` : ""}
      ${priceHtml(e)}
    </div>`;
  return el;
}

function render() {
  renderFilters();
  const list = EVENTS.filter(match).filter(visible)
    .map(e => ({ e, key: firstUpcoming(e) || parse(e.stops[0].date) }))
    .sort((a, b) => a.key - b.key);

  const up = EVENTS.filter(match).map(e => ({ e, d: firstUpcoming(e) })).filter(x => x.d).sort((a, b) => a.d - b.d)[0];
  const nx = document.getElementById("next");
  if (up) {
    const days = Math.round((up.d - today) / 86400000);
    document.getElementById("next-dd").textContent = days === 0 ? "D-DAY" : `D-${days}`;
    document.getElementById("next-lbl").textContent = `다음 공연 · ${up.d.getMonth() + 1}월 ${up.d.getDate()}일 (${WD[up.d.getDay()]})`;
    document.getElementById("next-t").textContent = up.e.title;
    nx.hidden = false;
  } else nx.hidden = true;

  document.getElementById("count").textContent = `${list.length}개 공연 · 총 ${list.reduce((n, x) => n + x.e.stops.length, 0)}회`;
  const tl = document.getElementById("timeline");
  tl.innerHTML = "";
  if (!list.length) { tl.innerHTML = '<p class="empty">이 조건에 맞는 예정된 공연이 없습니다. 다른 종류나 밴드를 골라 보세요.</p>'; return; }
  const groups = new Map();
  for (const x of list) {
    const k = `${x.key.getFullYear()}-${x.key.getMonth()}`;
    if (!groups.has(k)) groups.set(k, { d: x.key, items: [] });
    groups.get(k).items.push(x.e);
  }
  for (const g of groups.values()) {
    const sec = document.createElement("section"); sec.className = "month";
    sec.innerHTML = `<h2>${g.d.getMonth() + 1}월 <small>${g.d.getFullYear()}</small></h2>`;
    const box = document.createElement("div"); box.className = "list";
    for (const e of g.items) box.appendChild(card(e));
    sec.appendChild(box); tl.appendChild(sec);
  }
}

document.getElementById("show-past").addEventListener("change", ev => { showPast = ev.target.checked; render(); });

fetch("data.json", { cache: "no-cache" })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(d => {
    EVENTS = d.events || [];
    document.getElementById("sub").textContent = `BanG Dream! 공식 사이트 이벤트 목록 기준 · ${d.updated || ""} 갱신`;
    render();
  })
  .catch(() => {
    document.getElementById("timeline").innerHTML = '<p class="empty">일정 데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p>';
  });
