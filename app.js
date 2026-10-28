(() => {
  'use strict';
  const M = window.ReportModel, data = window.REPORT_DATA;
  const $ = id => document.getElementById(id);
  if (!M || !data) { $('panel-results').textContent = 'Не удалось загрузить отчёт. Обновите страницу.'; return; }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paragraphsHTML = value => String(value ?? '').split(/\r?\n\s*\r?\n/).filter(p => p.trim()).map(p => `<p>${esc(p)}</p>`).join('');
  const strongHTML = value => esc(value).replace(/\*\*([^*\r\n]+)\*\*/g, '<strong>$1</strong>');
  const detailParagraphsHTML = value => String(value ?? '').split(/\r?\n\s*\r?\n/).filter(p => p.trim()).map(p => `<p>${strongHTML(p)}</p>`).join('');
  const number = value => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value);
  const dateLabel = value => value ? new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value + 'T12:00:00Z')) : '';
  const icon = (name, cls = '') => `<svg class="${cls}" width="20" height="20" aria-hidden="true" viewBox="0 0 24 24">${{
    arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', chevron:'<path d="m9 5 7 7-7 7"/>',
    external:'<path d="M7 17 17 7M7 7h10v10"/>', work:'<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2m-6 6h6m-6 5h6"/>',
    chart:'<path d="M4 3v17h17M9 15v-4m5 4V6m5 9V9"/>', up:'<path d="M12 20V4m-6 6 6-6 6 6"/>', down:'<path d="M12 4v16m-6-6 6 6 6-6"/>'
  }[name] || ''}</svg>`;
  const tabs = ['results','works'], months = M.months(data), dialog = $('detail-dialog');
  const hasWorkDetails = month => month >= '2026-10';
  const state = {month:M.defaultMonth(data),tab:'works',detail:null,filters:{search:'',direction:'',trend:'all'},limit:25,engine:'yandex',cohort:'all',trafficSeries:['total','google']};
  let view = null, report = null, positionColumns = null, renderedMonth = null, currentDetail = null, lastOpener = null;
  const linkHTML = item => M.safeHref(item.url) ? `<a href="${esc(M.safeHref(item.url))}" target="_blank" rel="noopener noreferrer">${esc(item.label || item.url)}${icon('external')}</a>` : esc(item.label || 'Ссылка недоступна');
  function readRoute() {
    const url = new URL(location.href), month = url.searchParams.get('month'), tab = url.hash.slice(1);
    return {month:months.includes(month) ? month : M.defaultMonth(data), tab:tabs.includes(tab) ? tab : 'works', detail:url.searchParams.get('work')};
  }
  function routeURL() {
    const url = new URL(location.href);
    url.searchParams.set('month',state.month); url.searchParams.delete('task');
    if (state.detail) url.searchParams.set('work',state.detail); else url.searchParams.delete('work');
    url.hash = state.tab; return url;
  }
  function navigate(changes, {replace = false, focusTab = false} = {}) {
    if (changes.month && changes.month !== state.month) { state.filters = {search:'',direction:'',trend:'all'}; state.limit = 25; state.cohort = 'all'; }
    Object.assign(state, changes);
    if (state.detail && (state.tab !== 'works' || !hasWorkDetails(state.month) || !M.getReport(data,state.month)?.works.some(w => w.id === state.detail))) state.detail = null;
    try { history[replace ? 'replaceState' : 'pushState'](null,'',routeURL()); } catch (_) {}
    render(); if (focusTab) $('tab-' + state.tab).focus({preventScroll:true});
  }
  function pendingHTML(kind) {
    const heading = kind === 'works' ? 'Работы за этот месяц ещё не добавлены' : 'Позиции за этот месяц ещё не добавлены';
    const text = kind === 'works' ? 'Будем добавлять выполненные работы по мере готовности. Итоги месяца появятся после его завершения.' : 'Здесь появятся сохранённые замеры Яндекса и Google с фактическими датами проверки.';
    return `<div class="empty-state surface"><div class="empty-symbol">${icon(kind === 'works' ? 'work' : 'chart')}</div><div><h2>${heading}</h2><p>${text}</p></div></div>`;
  }
  function kpiHTML(engine, top) {
    if (report.archive) {
      const metric = report.archive.kpis[engine]['top' + top];
      const before = metric.before.replace(/^Было:\s*/i,'').trim(), after = metric.after.replace(/^Стало:\s*/i,'').trim();
      return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><div class="kpi-values"><div><span class="kpi-period">Было</span><span class="number before">${esc(before)}</span></div>${icon('arrow','kpi-arrow')}<div><span class="kpi-period">Стало</span><span class="number neutral">${esc(after)}</span></div></div><p class="kpi-count archive-change">${esc(metric.change)}</p></div>`;
    }
    const stats = view?.stats[engine], snapshots = view?.snapshotCounts?.[engine];
    const metric = snapshots ? {before:snapshots.before['top'+top],after:snapshots.after['top'+top]} : stats?.['top' + top];
    const total=snapshots?.after.total??stats?.total;
    if (!total) return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><p class="no-metric">Нет данных</p></div>`;
    const after = metric.after / total * 100, before = metric.before === null ? null : metric.before / total * 100;
    const trend = before === null || after === before ? 'neutral' : after > before ? 'positive' : 'negative';
    return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><div class="kpi-values">${before === null ? '' : `<div><span class="kpi-period">Было</span><span class="number before">${number(metric.before)}</span></div>${icon('arrow','kpi-arrow')}`}<div>${before === null ? '' : '<span class="kpi-period">Стало</span>'}<span class="number ${trend}">${number(metric.after)}</span></div></div><p class="kpi-count">из ${number(total)} запросов · ${number(after)}%</p></div>`;
  }
  function engineKpisHTML() {
    return `<div class="engine-kpi-grid">${M.ENGINES.map(engine => `<section class="engine-kpi-card surface engine-${engine}" aria-labelledby="kpi-heading-${engine}"><h3 class="searcher-name" id="kpi-heading-${engine}">${engine==='yandex'?'Яндекс':'Google'}</h3><div class="engine-kpi-metrics">${[10,3].map(top=>kpiHTML(engine,top)).join('')}</div></section>`).join('')}</div>`;
  }
  function rankCharts() {
    const archive = report.archive;
    if (!archive && !view) return '';
    const percent = text => Number.parseFloat(text.replace(/^.*?:\s*/,'').replace(',','.'));
    const stats = archive ? Object.fromEntries(M.ENGINES.map(engine => [engine, Object.fromEntries([3,10].map(top => ['top' + top, {
      before:percent(archive.kpis[engine]['top' + top].before), after:percent(archive.kpis[engine]['top' + top].after)
    }]))])) : Object.fromEntries(M.ENGINES.map(engine=>{
      const s=view.stats[engine],snapshots=view.snapshotCounts?.[engine];
      return [engine,snapshots?{...s,comparable:true,top3:{before:snapshots.before.top3,after:snapshots.after.top3},top10:{before:snapshots.before.top10,after:snapshots.after.top10}}:s];
    }));
    const chartTops=()=>[3,10];
    const max=Math.max(1,...Object.values(stats).flatMap(s=>chartTops(s).flatMap(top=>[s['top'+top].before,s['top'+top].after]).filter(Number.isFinite)));
    return `<div class="charts-grid">${M.ENGINES.map(engine => {
      const s = stats[engine], comparable = archive || s.comparable;
      if (!archive && !s.total) return '';
      const bars = chartTops(s).map(top => `<div class="rank-bar-group">${['before','after'].map(side => {
        const value = s['top' + top][side];
        return Number.isFinite(value) ? `<div class="rank-bar ${side}" style="height:${value / max * 104}px"><span>${number(value)}${archive ? '%' : ''}</span></div>` : '';
      }).join('')}<strong>Топ-${top}</strong></div>`).join('');
      const name = engine === 'yandex' ? 'Яндекс' : 'Google';
      return `<section class="ranking-chart surface" aria-label="${name}: ${archive ? 'доли запросов по архивной сводке' : 'количество запросов'}"><h3>${name}</h3>${archive ? '<p class="archive-chart-note">Доли запросов по сводке архивного отчёта</p>' : ''}<div class="rank-bars">${bars}</div><div class="chart-legend">${comparable ? `<span><i class="before-key"></i>Было${archive ? '' : ' · ' + dateLabel(view.before.date)}</span>` : ''}<span><i></i>${comparable ? 'Стало' : 'Сейчас'}${archive ? '' : ' · ' + dateLabel(view.after.date)}</span></div></section>`;
    }).join('')}</div>`;
  }
  function trafficHTML() {
    if(!report.traffic)return '';
    const traffic=report.traffic;
    if(!traffic.periods||!traffic.weeks?.length)return `<section class="traffic-card surface"><div><h3>Поисковый трафик</h3><p class="traffic-value">${number(traffic.visits)}<span>визитов</span></p></div></section>`;
    const {before,after}=traffic.periods,period=value=>`${dateLabel(value.from).slice(0,5)}–${dateLabel(value.to)}`;
    const metric=(key,label)=>{
      const delta=after[key]-before[key],percent=before[key]?delta/before[key]*100:null;
      return `<div class="traffic-metric"><h4>${label}</h4><div class="traffic-totals"><span>${number(before[key])}</span>${icon('arrow')}<strong>${number(after[key])}</strong></div><p class="${delta>0?'positive':delta<0?'negative':'neutral'}">${percent===null?'Нет сопоставимой базы':`${delta>0?'+':''}${number(percent)}%`}<span> · ${delta>0?'+':''}${number(delta)} визитов</span></p></div>`;
    };
    const weeks=traffic.weeks,W=900,H=300,pad={left:48,right:28,top:24,bottom:50},max=Math.ceil(Math.max(1,...weeks.map(w=>w.total))/50)*50;
    const x=i=>pad.left+i*(W-pad.left-pad.right)/Math.max(1,weeks.length-1),y=v=>H-pad.bottom-v/max*(H-pad.top-pad.bottom);
    const names={total:'Весь поиск',google:'Google'};
    const lines=['total','google'].map(key=>`<g data-traffic-line="${key}"${state.trafficSeries.includes(key)?'':' hidden'}><polyline class="traffic-line line-${key}" points="${weeks.map((w,i)=>`${x(i)},${y(w[key])}`).join(' ')}"></polyline>${weeks.map((w,i)=>`<circle class="traffic-point point-${key}" cx="${x(i)}" cy="${y(w[key])}" r="5" tabindex="0" role="img" data-traffic-week="${i}" aria-label="${esc(names[key])}, ${period(w)}: ${number(w[key])} визитов"><title>${esc(names[key])}: ${number(w[key])} · ${period(w)}</title></circle>`).join('')}</g>`).join('');
    const grid=Array.from({length:6},(_,i)=>{const value=max*i/5;return `<line class="traffic-gridline" x1="${pad.left}" x2="${W-pad.right}" y1="${y(value)}" y2="${y(value)}"></line><text class="traffic-axis-label" x="${pad.left-12}" y="${y(value)+5}" text-anchor="end">${number(value)}</text>`;}).join('');
    const labels=weeks.map((w,i)=>i%4===0||i===weeks.length-1?`<text class="traffic-axis-label" x="${x(i)}" y="${H-18}" text-anchor="${i===0?'start':i===weeks.length-1?'end':'middle'}">${dateLabel(w.from).slice(0,5)}</text>`:'').join('');
    return `<section class="traffic-card traffic-report surface" aria-labelledby="traffic-heading"><div class="traffic-report-heading"><h3 id="traffic-heading">Поисковый трафик</h3></div><div class="traffic-metric-grid">${metric('total','Все поисковые системы')}${metric('google','Google')}</div><figure class="traffic-weekly-figure"><figcaption>Визиты из поиска по неделям</figcaption><div class="traffic-series-switch" role="group" aria-label="Ряды недельного графика">${['total','google'].map(key=>`<button type="button" data-traffic-series="${key}" aria-pressed="${state.trafficSeries.includes(key)}"><i class="series-key key-${key}" aria-hidden="true"></i>${names[key]}</button>`).join('')}</div><div class="traffic-chart-scroll" role="region" tabindex="0" aria-label="Недельный график поискового трафика"><svg class="traffic-weekly-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="Недельные визиты из поиска и Google">${grid}${lines}${labels}</svg></div><p class="traffic-point-readout" id="traffic-point-readout" aria-live="polite">${trafficWeekText(weeks.at(-1))}</p></figure>${M.safeHref(traffic.csv)?`<p class="traffic-csv">${linkHTML({url:traffic.csv,label:'Скачать данные о поисковом трафике (CSV)'})}</p>`:''}</section>`;
  }
  function trafficWeekText(week) {
    return week?`${dateLabel(week.from).slice(0,5)}–${dateLabel(week.to)}: весь поиск — ${number(week.total)}, Google — ${number(week.google)} визитов.`:'';
  }
  function scopeHTML() {
    if(!report.rankings?.cohorts?.length||!view||view.pending)return '';
    return `<section class="rank-scope surface" aria-label="Выборка запросов"><div class="scope-options" role="group" aria-label="Выборка запросов"><button type="button" data-rank-scope="all" aria-pressed="${state.cohort==='all'}">Все запросы</button>${report.rankings.cohorts.map(c=>`<button type="button" data-rank-scope="${esc(c.id)}" aria-pressed="${state.cohort===c.id}">${esc(c.label)}</button>`).join('')}</div></section>`;
  }
  function rankCell(value, archive = false) {
    if (value === undefined || value === null || value === '' || value === '—' || value === '--') return '<span class="rank-value rank-other rank-placeholder" title="101 — условное значение: нет данных или вне проверки">101</span>';
    const numeric = Number(value), band = numeric > 0 && numeric <= 3 ? 'top3' : numeric <= 10 && numeric > 0 ? 'top10' : numeric <= 30 && numeric > 0 ? 'top30' : 'other';
    return `<span class="rank-value rank-${band}">${archive ? esc(value) : number(value)}</span>`;
  }
  function currentRankCell(value, before) {
    const change=M.rankDisplayChange(before,value);
    const labels={up:`На ${number(change.amount)} позиций выше`,down:`На ${number(change.amount)} позиций ниже`,appeared:'Появился в выдаче',lost:'Вышел за пределы проверки',new:'Новый запрос'};
    const badge=change.kind==='up'?`+${number(change.amount)}`:change.kind==='down'?`−${number(change.amount)}`:change.kind==='appeared'?'↑':change.kind==='lost'?'↓':change.kind==='new'?'нов.':'';
    return `<span class="rank-position-trend rank-trend-${change.kind}">${rankCell(value)}${badge?`<span class="rank-delta" title="${esc(labels[change.kind])}" aria-label="${esc(labels[change.kind])}">${badge}</span>`:''}</span>`;
  }
  function queryTableHTML() {
    if (!report.archive && !view) return '';
    const archive=report.archive,rows=archive?archive.rows:view.rows;
    const directions=[...new Set(rows.map(r=>r.direction).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    positionColumns=Object.fromEntries(M.ENGINES.map(engine=>[engine,archive?archive.dates[engine].map((d,i,dates)=>({...d,key:i,role:i===dates.length-1?'after':i===0?'start':'before'})):
      ['start','before','after'].map(role=>{const snapshot=report.rankings[role];return {key:role,role,date:snapshot?.date||null,lookup:new Map((snapshot?.rows||[]).map(row=>[row.id,row]))};})]));
    const counts=Object.fromEntries(M.ENGINES.map(e=>[e,positionColumns[e].length]));
    const heading=engine=>positionColumns[engine].map((column,i)=>`<th id="rank-${engine}-${column.key}" scope="col" class="engine-${engine} period-${column.role} ${i===0?'engine-start':''} ${column.role==='after'?'current':''}"><time datetime="${column.date||''}" aria-label="${dateLabel(column.date)}">${column.date?dateLabel(column.date).replace(/(\d{2}\.\d{2}\.)(\d{4})/,'$1<wbr>$2'):'—'}</time><span class="rank-visibility" data-rank-visibility-engine="${engine}" data-rank-visibility-key="${column.key}"><span class="rank-visibility-range" aria-hidden="true">1–10</span><strong class="rank-visibility-value">—</strong></span></th>`).join('');
    const columns=M.ENGINES.map(engine=>positionColumns[engine].map(()=>`<col class="rank-col engine-${engine}">`).join('')).join('');
    const legend=archive?`<div class="rank-legend" aria-label="Обозначения позиций"><span><i class="rank-key rank-top3" aria-hidden="true"></i>Топ-3</span><span><i class="rank-key rank-top10" aria-hidden="true"></i>4–10</span><span><i class="rank-key rank-top30" aria-hidden="true"></i>11–30</span><span><i class="rank-key rank-other" aria-hidden="true"></i>101</span></div>`:'';
    return `<section class="queries-card surface"><div class="section-heading"><h2>Позиции запросов</h2></div><div class="table-filters"><div class="filter-field search"><label for="query-search">Найти запрос</label><input id="query-search" type="search" placeholder="Например, стоматология Сургут" value="${esc(state.filters.search)}"></div><div class="filter-field direction"><label for="direction-filter">Направление</label><div class="select-wrap"><select id="direction-filter"><option value="">Все направления</option>${directions.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>${icon('chevron')}</div></div>${!archive&&view.before&&!view.pending&&report.rankings?.presentation?.comparison!=='previous_month'?`<div class="filter-field trend"><label for="trend-filter">Динамика</label><div class="select-wrap"><select id="trend-filter">${[['all','Все изменения'],['up','Рост'],['down','Снижение'],['same','Без изменений'],['new','Новые запросы']].map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select>${icon('chevron')}</div></div>`:''}</div>${legend}<div class="mobile-engine" role="group" aria-label="Поисковик в таблице"><button type="button" data-engine="yandex" aria-pressed="${state.engine==='yandex'}">Яндекс</button><button type="button" data-engine="google" aria-pressed="${state.engine==='google'}">Google</button></div><div class="table-scroll" id="positions-wrap" data-engine="${state.engine}" role="region" tabindex="0" aria-label="Позиции запросов"><table class="positions-table snapshot-positions" style="--rank-columns:${counts.yandex+counts.google};--yandex-columns:${counts.yandex};--google-columns:${counts.google}"><caption class="sr-only">Позиции запросов за ${esc(M.monthLabel(state.month).toLowerCase())}</caption><colgroup><col class="query-col">${columns}</colgroup><thead><tr><th id="query-heading" rowspan="2" scope="col" class="query-heading">Запрос</th><th id="engine-yandex" colspan="${counts.yandex}" scope="colgroup" class="engine-yandex engine-title engine-start">Яндекс</th><th id="engine-google" colspan="${counts.google}" scope="colgroup" class="engine-google engine-title engine-start">Google</th></tr><tr>${M.ENGINES.map(heading).join('')}</tr></thead><tbody id="query-rows"></tbody></table></div><p id="query-empty" class="query-empty" hidden>Запросы не найдены. Измените поиск или фильтры.</p><div class="table-footer"><span id="query-count" role="status" aria-live="polite"></span><button type="button" class="button-secondary" id="show-more">Показать ещё 25</button></div></section>`;
  }
  function renderQueries() {
    if (!$('query-rows')) return;
    const archive=report.archive,allRows=archive?archive.rows:view.rows;
    const filtered=M.filterRows(allRows,state.filters),visible=filtered.slice(0,state.limit);
    const headerRows=filtered.map(row=>Object.fromEntries(M.ENGINES.map(engine=>[engine,Object.fromEntries(positionColumns[engine].map(column=>{
      const value=archive?row[engine][column.key]:column.lookup?.get(row.id)?.[engine];
      return [column.key,archive&&/^[1-9]\d*$/.test(String(value))?Number(value):value];
    }))])));
    for(const engine of M.ENGINES)for(const column of positionColumns[engine]){
      const metric=M.rankVisibility(headerRows,engine,column.key),element=document.querySelector(`[data-rank-visibility-engine="${engine}"][data-rank-visibility-key="${column.key}"]`);
      if(!element)continue;
      element.querySelector('.rank-visibility-value').textContent=metric.percent===null?'—':`${number(Math.round(metric.percent))}%`;
      element.title=`В топ-10: ${number(metric.top10)} из ${number(metric.total)}`;
      element.setAttribute('aria-label',element.title);
      element.dataset.top10=metric.top10;element.dataset.total=metric.total;
    }
    $('query-rows').innerHTML=visible.map((row,rowIndex)=>`<tr><th id="query-${rowIndex}" scope="row" class="query-name">${esc(row.query)}</th>${M.ENGINES.map(engine=>positionColumns[engine].map((column,i)=>{
      const original=column.lookup?.get(row.id);
      const value=archive?row[engine][column.key]:original?.[engine];
      const beforeColumn=positionColumns[engine].find(c=>c.role==='before');
      const before=beforeColumn?.lookup?.get(row.id)?.[engine];
      return `<td headers="query-${rowIndex} engine-${engine} rank-${engine}-${column.key}" class="engine-${engine} period-${column.role} ${i===0?'engine-start':''} ${column.role==='after'?'current':''}">${!archive&&column.role==='after'?currentRankCell(value,before):rankCell(value,!!archive)}</td>`;
    }).join('')).join('')}</tr>`).join('');
    $('positions-wrap').hidden=filtered.length===0;$('query-empty').hidden=filtered.length!==0;
    $('query-count').textContent=`Показано: ${visible.length} из ${filtered.length}`;$('show-more').hidden=state.limit>=filtered.length;
  }
  function resultsHTML() {
    view=M.rankingsView(report.rankings,{cohort:state.cohort});
    let intro=report.intro.map(detailParagraphsHTML).join('');
    if(report.conclusions.length)intro+=report.conclusions.map(detailParagraphsHTML).join('');
    const heading=`<div class="results-heading"><h2>Результаты за ${M.monthLabel(state.month).toLowerCase()}</h2>${intro?`<div class="results-intro">${intro}</div>`:''}</div>`;
    return heading+(report.archive||(view&&!view.pending)?trafficHTML()+scopeHTML()+engineKpisHTML()+rankCharts()+queryTableHTML():trafficHTML()+(view?queryTableHTML():pendingHTML('results')));
  }
  function worksHTML() {
    if (!report.works.length) return pendingHTML('works');
    const details = hasWorkDetails(state.month);
    return `<div class="works-heading"><h2>Работы за ${M.monthLabel(state.month).toLowerCase()}</h2></div><section class="surface"><table class="works-table${details ? '' : ' without-details'}"><thead><tr><th scope="col">Что сделали</th><th scope="col">Краткое описание</th><th scope="col">Для чего это нужно</th>${details ? '<th scope="col">Подробнее</th>' : ''}</tr></thead><tbody>${report.works.map(work => `<tr><td><h3 class="work-name">${esc(work.title)}</h3></td><td class="work-summary">${esc(work.summary)}</td><td data-label="Для чего это нужно">${work.why ? paragraphsHTML(work.why) : '—'}</td>${details ? `<td><button type="button" class="work-open" data-work="${esc(work.id)}" aria-label="Подробнее: ${esc(work.title)}">Подробнее${icon('arrow')}</button></td>` : ''}</tr>`).join('')}</tbody></table></section>`;
  }
  function tableHTML(item, emphasize = false) {
    const isUrlMap = item.rows.length > 0 && item.rows.every(row => row.length === 3 && [row[1],row[2]].every(value => typeof value === 'string' && value.startsWith('/')));
    const content = emphasize ? strongHTML : esc;
    const compact = emphasize && item.columns.length <= 3 && !isUrlMap;
    return `${isUrlMap || compact ? '' : '<p class="table-scroll-hint">Проведите по таблице влево, чтобы увидеть остальные показатели.</p>'}<div class="table-scroll" role="region" aria-label="${esc(item.label)}"${isUrlMap ? '' : ' tabindex="0"'}><table class="evidence-table${isUrlMap ? ' evidence-url-map' : compact ? ' evidence-compact' : ''}" role="table"><thead role="rowgroup"><tr role="row">${item.columns.map(c => `<th scope="col" role="columnheader">${content(c)}</th>`).join('')}</tr></thead><tbody role="rowgroup">${item.rows.map(row => `<tr role="row">${item.columns.map((column,i) => `<td data-label="${esc(column)}" role="cell">${isUrlMap && i > 0 ? content(row[i]).replaceAll('/','/<wbr>').replaceAll('-','-<wbr>') : content(row[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function evidenceHTML(item) {
    if (item.type === 'link') return `<p class="detail-resource">${linkHTML(item)}</p>`;
    let body = '';
    const hasImages = item.type === 'comparison' && M.safeImageHref(item.beforeImage) && M.safeImageHref(item.afterImage);
    if (item.type === 'comparison') {
      const sideHTML = (side,label) => `<div><h4>${label}</h4>${item[side] ? `<p>${esc(item[side])}</p>` : ''}${hasImages ? `<figure class="comparison-screenshot"><a href="${esc(item[side + 'Image'])}" target="_blank" rel="noopener noreferrer" aria-label="${label}: открыть снимок в полном размере"><img src="${esc(item[side + 'Image'])}" alt="${esc(item[side + 'Alt'])}" loading="lazy" decoding="async"></a><figcaption>Нажмите на снимок, чтобы открыть его в полном размере.</figcaption></figure>` : ''}</div>`;
      body = `<div class="comparison-grid${hasImages ? ' has-images' : ''}">${sideHTML('before','Было')}${sideHTML('after','Стало')}</div>`;
    }
    if (item.type === 'table') body = tableHTML(item);
    return `<details class="evidence-block"${hasImages || item.type === 'table' ? ' open' : ''}><summary>${esc(item.label)}</summary><div class="evidence-content">${item.text ? `<p class="evidence-intro">${esc(item.text)}</p>` : ''}${body}</div></details>`;
  }
  function sectionHTML(section) {
    return `<section class="detail-section">${section.title?.trim() ? `<h3>${esc(section.title)}</h3>` : ''}${detailParagraphsHTML(section.text)}${section.bullets?.length ? `<ul>${section.bullets.map(b => `<li>${strongHTML(b)}</li>`).join('')}</ul>` : ''}${section.table ? tableHTML({...section.table,label:section.table.label || section.title || 'Таблица'},true) : ''}${section.note ? `<p class="section-note">${strongHTML(section.note)}</p>` : ''}${detailParagraphsHTML(section.afterText)}${section.links?.length ? `<ul class="detail-links">${section.links.map(l => `<li>${linkHTML(l)}</li>`).join('')}</ul>` : ''}</section>`;
  }
  function renderDetail() {
    const work = state.tab === 'works' && hasWorkDetails(state.month) && report.works.find(w => w.id === state.detail);
    const key = work ? `${state.month}:${work.id}` : null;
    if (!work) {
      if (dialog.open) { dialog.close(); document.body.classList.remove('dialog-open'); (lastOpener?.isConnected ? lastOpener : $('tab-' + state.tab)).focus({preventScroll:true}); }
      currentDetail = null; return;
    }
    if (key === currentDetail && dialog.open) return;
    dialog.dataset.reportView = 'works'; $('detail-title').textContent = work.title; $('detail-meta').hidden = true;
    const sections = (work.sections || []).map(sectionHTML).join('');
    $('detail-body').innerHTML = `<section class="actual-result"><h3>Что сделали</h3>${detailParagraphsHTML(work.result)}${work.resultBullets?.length ? `<ul class="result-bullets">${work.resultBullets.map(b => `<li>${strongHTML(b)}</li>`).join('')}</ul>` : ''}${sections}${(work.evidence || []).map(evidenceHTML).join('')}</section>`;
    if (!dialog.open) { dialog.showModal(); document.body.classList.add('dialog-open'); }
    $('detail-body').scrollTop = 0; $('close-detail').focus({preventScroll:true}); currentDetail = key;
  }
  function render() {
    report = M.getReport(data,state.month); $('report-month').value = state.month;
    if (renderedMonth !== state.month) { $('panel-results').innerHTML = resultsHTML(); $('panel-works').innerHTML = worksHTML(); renderedMonth = state.month; }
    for (const tab of tabs) { $('tab-' + tab).setAttribute('aria-selected',String(state.tab === tab)); $('tab-' + tab).tabIndex = state.tab === tab ? 0 : -1; $('panel-' + tab).hidden = state.tab !== tab; }
    $('work-count').hidden = !report.works.length; $('work-count').textContent = report.works.length;
    document.title = `Отчёт по продвижению сайта «${data.project.name}» — ${M.monthLabel(state.month)}`;
    renderQueries(); renderDetail();
    if(state.tab==='results')positionTrafficChart();
  }
  $('report-client').textContent = `«${data.project.name}»`;
  $('site-link').href = M.safeHref(data.project.website); $('site-link').innerHTML = esc(new URL(data.project.website).hostname) + icon('external');
  $('period-label').textContent = months.length === 1 ? M.monthLabel(months[0]) : `${M.monthLabel(months[0])} — ${M.monthLabel(months.at(-1)).toLowerCase()}`;
  $('report-month').innerHTML = months.map(month => `<option value="${month}">${M.monthLabel(month)}</option>`).join('');
  $('report-month').addEventListener('change',event => { navigate({month:event.target.value,detail:null}); $('announcement').textContent = `Выбран ${M.monthLabel(state.month)}.`; });
  tabs.forEach((tab,index) => {
    $('tab-' + tab).addEventListener('click',() => navigate({tab,detail:null}));
    $('tab-' + tab).addEventListener('keydown',event => {
      if (event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      navigate({tab:tabs[next],detail:null},{focusTab:true});
    });
  });
  document.addEventListener('click',event => {
    const work = event.target.closest('[data-work]'); if (work) { lastOpener = work; navigate({detail:work.dataset.work}); return; }
    const scope=event.target.closest('button[data-rank-scope]');
    if(scope){
      state.cohort=scope.dataset.rankScope;state.filters={search:'',direction:'',trend:'all'};state.limit=25;
      $('panel-results').innerHTML=resultsHTML();renderQueries();positionTrafficChart();
      document.querySelector('[data-rank-scope="'+state.cohort+'"]').focus({preventScroll:true});
      $('announcement').textContent='Выборка: '+view.scope.label;return;
    }
    const series=event.target.closest('button[data-traffic-series]');
    if(series){
      const key=series.dataset.trafficSeries,index=state.trafficSeries.indexOf(key);
      if(index>=0&&state.trafficSeries.length===1)return;
      if(index<0)state.trafficSeries.push(key);else state.trafficSeries.splice(index,1);
      document.querySelectorAll('[data-traffic-line]').forEach(g=>g.toggleAttribute('hidden',!state.trafficSeries.includes(g.dataset.trafficLine)));
      document.querySelectorAll('[data-traffic-series]').forEach(b=>b.setAttribute('aria-pressed',String(state.trafficSeries.includes(b.dataset.trafficSeries))));return;
    }
    const engine = event.target.closest('button[data-engine]');
    if (engine) { state.engine = engine.dataset.engine; $('positions-wrap').dataset.engine = state.engine; document.querySelectorAll('button[data-engine]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.engine === state.engine))); return; }
    if (event.target.closest('#show-more')) { state.limit += 25; renderQueries(); }
  });
  document.addEventListener('input',event => { if (event.target.id === 'query-search') { state.filters.search = event.target.value; state.limit = 25; renderQueries(); } });
  document.addEventListener('change',event => {
    if (event.target.id === 'direction-filter') state.filters.direction = event.target.value;
    else if (event.target.id === 'trend-filter') state.filters.trend = event.target.value; else return;
    state.limit = 25; renderQueries();
  });
  function positionTrafficChart(){
    const chart=document.querySelector('.traffic-chart-scroll');
    if(chart)chart.scrollLeft=chart.scrollWidth;
  }
  function showTrafficPoint(event){
    const point=event.target.closest?.('[data-traffic-week]');
    if(point&&$('traffic-point-readout'))$('traffic-point-readout').textContent=trafficWeekText(report.traffic.weeks[Number(point.dataset.trafficWeek)]);
  }
  document.addEventListener('pointerover',showTrafficPoint);
  document.addEventListener('focusin',showTrafficPoint);
  $('close-detail').addEventListener('click',() => navigate({detail:null}));
  dialog.addEventListener('cancel',event => { event.preventDefault(); navigate({detail:null}); });
  dialog.addEventListener('click',event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) navigate({detail:null}); } });
  function restoreRoute() { navigate(readRoute(),{replace:true}); }
  window.addEventListener('popstate',restoreRoute); window.addEventListener('hashchange',restoreRoute);
  navigate(readRoute(),{replace:true});
})();
