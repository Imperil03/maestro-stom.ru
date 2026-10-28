(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ReportModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ENGINES = ['yandex', 'google'];
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const monthLabel = (month, year = true) => `${MONTHS[Number(month.slice(5)) - 1]}${year ? ' ' + month.slice(0,4) : ''}`;
  const months = data => data.reports.map(r => r.month).sort();
  const getReport = (data, month) => data.reports.find(r => r.month === month) || null;
  const defaultMonth = data => months(data).includes(data.project.currentMonth) ? data.project.currentMonth : months(data).at(-1);
  const normalize = value => String(value ?? '').toLocaleLowerCase('ru-RU').trim().replace(/\s+/g, ' ');
  function safeHref(value) {
    if (typeof value !== 'string') return null;
    if (/^evidence\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) && !value.split('/').includes('..')) return value;
    try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch (_) {}
    return null;
  }
  function safeImageHref(value) {
    return typeof value === 'string' && value.startsWith('evidence/') && /\.(png|jpe?g|webp)$/.test(value) && safeHref(value) === value ? value : null;
  }
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value;
  }
  function rankChange(before, after, comparable, isNew = false) {
    if (!comparable || after === undefined) return {kind:'no_data', amount:null};
    if (isNew || before === undefined) return {kind:'new', amount:null};
    if (before === null && after === null) return {kind:'same', amount:0};
    if (before === null) return {kind:'appeared', amount:null};
    if (after === null) return {kind:'lost', amount:null};
    return {kind:before > after ? 'up' : before < after ? 'down' : 'same', amount:Math.abs(before - after)};
  }
  function legacySameSettings(before, after, engine) {
    if (!before || !after || before.region !== after.region || before.device !== after.device || before.sourceKey !== after.sourceKey) return false;
    return JSON.stringify(before.engines?.[engine] ?? null) === JSON.stringify(after.engines?.[engine] ?? null);
  }
  function comparisonSettings(before, after, engine) {
    const a = before?.engines?.[engine], b = after?.engines?.[engine];
    const profiled = value => !!value && typeof value.provider === 'string' && ['live','xml'].includes(value.mode) && Number.isInteger(value.depth) && value.depth > 0 && value.rankBasis === 'organic';
    const oldDepth = Number.isInteger(a?.depth) ? a.depth : null, newDepth = Number.isInteger(b?.depth) ? b.depth : null;
    const base = {beforeDepth:oldDepth,afterDepth:newDepth,commonDepth:oldDepth && newDepth ? Math.min(oldDepth,newDepth) : null};
    if (!profiled(a) && !profiled(b)) {
      const comparable = legacySameSettings(before,after,engine);
      return {...base,comparable,type:comparable ? 'same_provider' : 'incompatible',providerChanged:false,reason:comparable ? '' : 'Настройки замеров различаются.'};
    }
    if (!profiled(a) || !profiled(b)) return {...base,comparable:false,type:'incompatible',providerChanged:false,reason:'Не подтверждён профиль одного из замеров.'};
    const region = (snapshot,meta) => normalize(meta.region || snapshot.region);
    const compatible = region(before,a) === region(after,b) && a.device === b.device && normalize(a.language) === normalize(b.language) && a.mode === b.mode && a.rankBasis === b.rankBasis;
    const providerChanged = a.provider !== b.provider;
    return {...base,comparable:compatible,type:!compatible ? 'incompatible' : providerChanged ? 'provider_changed' : 'same_provider',providerChanged,
      reason:!compatible ? 'Различаются регион, устройство, язык или режим выдачи.' : providerChanged ? 'Сменился сервис съёма; сравнение ориентировочное.' : ''};
  }
  const sameSettings = (before,after,engine) => comparisonSettings(before,after,engine).comparable;
  const withinDepth = (value,depth) => typeof value === 'number' && depth && value > depth ? null : value;
  const displayRank = (value, missingRank = 101) => typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : missingRank;
  function snapshotCounts(rows) {
    return Object.fromEntries(ENGINES.map(engine => [engine,Object.fromEntries(['start','before','after'].map(side => {
      const values = rows.map(row => row[engine]?.[side]);
      return [side,{total:rows.length,measured:values.filter(value => value !== undefined).length,
        top3:values.filter(value => typeof value === 'number' && value <= 3).length,
        top10:values.filter(value => typeof value === 'number' && value <= 10).length}];
    }))]));
  }
  function rankingsView(rankings, {cohort = 'all'} = {}) {
    const monthlyComparison = rankings?.presentation?.comparison === 'previous_month';
    const selected = cohort === 'all' ? null : rankings?.cohorts?.find(c => c.id === cohort);
    if (cohort !== 'all' && !selected) throw new RangeError('Неизвестная выборка запросов.');
    const selectedIds = selected ? new Set(selected.queryIds) : null;
    const scoped = rows => selectedIds ? rows.filter(row => selectedIds.has(row.id)) : rows;
    const scope = selected ? {id:selected.id,label:selected.label,queryIds:[...selected.queryIds]} : {id:'all',label:'Все запросы'};
    const history = rankings ? {start:rankings.start || null,before:rankings.before || null} : null;
    if (rankings?.pending && !rankings.after) {
      const {start,before}=rankings, reference=before||start;
      if (!reference) return null;
      const initial=new Map((start?.rows||[]).map(r=>[r.id,r]));
      const previous=new Map((before?.rows||[]).map(r=>[r.id,r]));
      const rows=scoped(reference.rows).map(r=>{
        const row={id:r.id,query:r.query,direction:r.direction||'',isNew:false,removed:false};
        for(const engine of ENGINES){
          const first=initial.get(r.id);
          row[engine]={start:first&&normalize(first.query)===normalize(r.query)&&(monthlyComparison||sameSettings(start,reference,engine))?first[engine]:undefined,before:previous.get(r.id)?.[engine],after:undefined,change:{kind:'no_data',amount:null}};
        }
        return row;
      });
      return {start,before,after:null,reference:rankings.reference || null,presentation:rankings.presentation || null,history,scope,rows,snapshotCounts:snapshotCounts(rows),stats:null,metaMatch:true,pending:true,notes:rankings.notes||[]};
    }
    if (!rankings?.after) return null;
    const {start, after} = rankings, before = monthlyComparison ? rankings.before : rankings.reference || rankings.before;
    const comparisons = Object.fromEntries(ENGINES.map(e => [e,comparisonSettings(before,after,e)]));
    const matches = Object.fromEntries(ENGINES.map(e => [e,comparisons[e].comparable]));
    const beforeMap = new Map((before?.rows || []).map(r => [r.id, r]));
    const startMap = new Map((start?.rows || []).map(r => [r.id, r]));
    const afterMap = new Map(after.rows.map(r => [r.id, r]));
    const rows = scoped([...new Set([...afterMap.keys(), ...beforeMap.keys()])].map(id => ({id}))).map(({id}) => {
      const old = beforeMap.get(id), current = afterMap.get(id), display = current || old;
      const renamed = !!(old && current && normalize(old.query) !== normalize(current.query));
      const isNew = !!before && (!old || renamed || ENGINES.every(e => !own(old, e)));
      const row = {id, query:display.query, direction:display.direction || '', isNew, removed:!current};
      for (const engine of ENGINES) {
        const previous = renamed ? undefined : old?.[engine];
        const initial = startMap.get(id);
        const initialMatches = initial && normalize(initial.query) === normalize(display.query) && (monthlyComparison || sameSettings(start,after,engine));
        const commonDepth = comparisons[engine].commonDepth;
        const compareBefore = withinDepth(previous,commonDepth), compareAfter = withinDepth(current?.[engine],commonDepth);
        const change = commonDepth && matches[engine] && !isNew && compareBefore === null && compareAfter === null ? {kind:'outside',amount:null} : rankChange(compareBefore,compareAfter,matches[engine],isNew);
        row[engine] = {start:initialMatches ? initial[engine] : undefined,before:previous,after:current?.[engine],error:Array.isArray(current?.failedEngines) && current.failedEngines.includes(engine),change};
      }
      return row;
    });
    const stats = {};
    for (const engine of ENGINES) {
      const comparableRows = rows.filter(r => !r.isNew && r[engine].before !== undefined && r[engine].after !== undefined);
      const currentRows = rows.filter(r => r[engine].after !== undefined);
      const comparable = matches[engine] && comparableRows.length > 0;
      const population = comparable ? comparableRows : currentRows;
      const count = (items,side,top) => items.filter(r => typeof r[engine][side] === 'number' && r[engine][side] <= top).length;
      const result = {comparable,total:population.length,pairedTotal:comparableRows.length,currentTotal:currentRows.length,
        newCount:currentRows.filter(r => r.isNew || r[engine].before === undefined).length,
        missingCount:scoped(after.rows).length - currentRows.length,
        errorCount:rows.filter(r => r[engine].error).length,
        movement:{up:0,down:0,same:0,outside:0}};
      result.unmeasuredCount = result.missingCount - result.errorCount;
      for (const top of [3,10,30]) {
        result['top'+top] = {before:comparable && (!comparisons[engine].beforeDepth || comparisons[engine].beforeDepth >= top) ? count(population,'before',top) : null,
          after:!comparisons[engine].afterDepth || comparisons[engine].afterDepth >= top ? count(population,'after',top) : null};
        result['currentTop'+top] = !comparisons[engine].afterDepth || comparisons[engine].afterDepth >= top ? count(currentRows,'after',top) : null;
      }
      if (comparable) for (const row of comparableRows) {
        const kind = row[engine].change.kind;
        if (['up','appeared'].includes(kind)) result.movement.up++;
        else if (['down','lost'].includes(kind)) result.movement.down++;
        else if (kind === 'same') result.movement.same++;
        else if (kind === 'outside') result.movement.outside++;
      }
      stats[engine] = result;
    }
    return {start,before,after,reference:rankings.reference || null,presentation:rankings.presentation || null,history,scope,rows,snapshotCounts:snapshotCounts(rows),stats,comparisons,metaMatch:ENGINES.every(e => matches[e]),pending:false,notes:rankings.notes||[]};
  }
  function filterRows(rows, {search = '', direction = '', trend = 'all'} = {}) {
    const term = normalize(search).replaceAll('ё', 'е');
    return rows.filter(row => {
      if (term && !normalize(row.query).replaceAll('ё','е').includes(term)) return false;
      if (direction && row.direction !== direction) return false;
      const kinds = ENGINES.map(e => row[e]?.change?.kind || 'no_data');
      if (trend === 'up') return kinds.some(k => ['up','appeared'].includes(k));
      if (trend === 'down') return kinds.some(k => ['down','lost'].includes(k));
      if (trend === 'same') return kinds.includes('same') && kinds.every(k => ['same','no_data'].includes(k));
      if (trend === 'new') return row.isNew;
      return true;
    });
  }
  function validateData(data) {
    const errors = [], check = (test, message) => { if (!test) errors.push(message); };
    if (!data?.project || !Array.isArray(data.reports)) return ['Нет настроек проекта или месяцев.'];
    check(data.project.id === 'maestro' && data.project.website === 'https://maestro-stom.ru/', 'Неверный проект отчёта.');
    check(months(data).includes(data.project.currentMonth), 'Текущий месяц отсутствует.');
    check(new Set(months(data)).size === data.reports.length, 'Повторный месяц.');
    for (const report of data.reports) {
      const label = report.month;
      check(report.projectId === data.project.id && /^\d{4}-(0[1-9]|1[0-2])$/.test(label), 'Неверный идентификатор месяца.');
      check(['in_progress','closed'].includes(report.status), `${label}: неизвестное состояние отчёта.`);
      for (const key of ['intro','conclusions']) check(Array.isArray(report[key]) && report[key].every(x => typeof x === 'string'), `${label}: неверный текст ${key}.`);
      check(!(report.archive && report.rankings), `${label}: архив смешан с API.`);
      if (report.archive) {
        const a = report.archive;
        check(a.sourceLabel === 'Google Таблица' && report.status === 'closed', `${label}: неверный источник архива.`);
        check(Array.isArray(a.rows) && a.rows.length > 0, `${label}: пустой архив позиций.`);
        check(new Set((a.rows || []).map(r => r.id)).size === a.rows?.length, `${label}: повторные запросы архива.`);
        for (const engine of ENGINES) {
          check(Array.isArray(a.dates?.[engine]) && a.dates[engine].every(d => validDate(d.date) && typeof d.label === 'string'), `${label}: неверные даты архива.`);
          for (const row of a.rows || []) {
            check(typeof row.query === 'string' && row.query.trim() && typeof row.id === 'string', `${label}: неверный запрос.`);
            check(Array.isArray(row[engine]) && row[engine].length === a.dates?.[engine]?.length && row[engine].every(v => v === null || typeof v === 'string'), `${label}: потеря столбцов архива.`);
          }
          for (const top of ['top10','top3']) check(['before','after','change'].every(k => typeof a.kpis?.[engine]?.[top]?.[k] === 'string'), `${label}: неполная сводка архива.`);
        }
      }
      if (report.rankings) {
        if (own(report.rankings,'presentation')) {
          const presentation = report.rankings.presentation;
          check(presentation && typeof presentation === 'object' && !Array.isArray(presentation) && presentation.comparison === 'previous_month' && presentation.missingRank === 101, `${label}: неверное оформление дат и пропусков.`);
          check(!!report.rankings.start && !!report.rankings.before && !!report.rankings.after, `${label}: для таблицы нужны три датированных замера.`);
        }
        const pending=report.rankings.pending===true;
        check(pending ? report.rankings.after===null && !!(report.rankings.before||report.rankings.start) : !!report.rankings.after, `${label}: нет текущего среза или явно зарезервированного столбца.`);
        if(pending)check(report.status==='in_progress',`${label}: ожидающий замер нельзя выдавать за завершённый отчёт.`);
        if(report.rankings.after)check(report.rankings.after.date?.slice(0,7) === label, `${label}: срез относится к другому месяцу.`);
        if(own(report.rankings,'notes'))check(Array.isArray(report.rankings.notes)&&report.rankings.notes.every(n=>typeof n==='string'),`${label}: неверные пояснения замеров.`);
        const snapshots = [report.rankings.start,report.rankings.before,report.rankings.reference,report.rankings.after].filter(Boolean);
        for (const snapshot of snapshots) {
          check(validDate(snapshot.date) && snapshot.region && snapshot.device && snapshot.sourceKey, `${label}: неполные настройки замера.`);
          check(Array.isArray(snapshot.rows) && new Set(snapshot.rows.map(r => r.id)).size === snapshot.rows.length, `${label}: неполные или повторные запросы.`);
          for (const engine of ENGINES) {
            const meta = snapshot.engines?.[engine];
            if (meta && ['provider','mode','depth','rankBasis'].some(k => own(meta,k))) {
              check(typeof meta.provider === 'string' && meta.provider.trim() && ['live','xml'].includes(meta.mode) && Number.isInteger(meta.depth) && meta.depth > 0 && meta.depth <= 1000 && meta.rankBasis === 'organic', `${label}: неполный профиль съёма ${engine}.`);
              check(typeof meta.region === 'string' && meta.region.trim() && [0,1,2].includes(meta.device) && typeof meta.language === 'string' && meta.language.trim(), `${label}: не подтверждены регион, язык или устройство ${engine}.`);
            }
          }
          for (const row of snapshot.rows || []) {
            check(typeof row.id === 'string' && typeof row.query === 'string' && row.query.trim(), `${label}: запрос без ID или текста.`);
            if (own(row,'failedEngines')) {
              const failures = row.failedEngines;
              check(snapshot === report.rankings.after && Array.isArray(failures) && new Set(failures).size === failures.length && failures.every(engine => ENGINES.includes(engine) && !own(row,engine)),`${label}: ошибка съёма должна быть отдельной от позиции текущего замера.`);
            }
            for (const engine of ENGINES) if (own(row, engine)) {
              check(row[engine] === null || (Number.isInteger(row[engine]) && row[engine] > 0 && row[engine] <= 1000), `${label}: неверная позиция.`);
              if (Number.isInteger(snapshot.engines?.[engine]?.depth) && typeof row[engine] === 'number') check(row[engine] <= snapshot.engines[engine].depth, `${label}: позиция за пределами подтверждённой глубины.`);
            }
          }
        }
        if (report.rankings.reference) check(!!report.rankings.after && report.rankings.reference.date < report.rankings.after.date, `${label}: неверная дата опорного замера.`);
        if (own(report.rankings,'cohorts')) {
          const cohorts = report.rankings.cohorts;
          check(Array.isArray(cohorts),`${label}: неверные выборки запросов.`);
          if (Array.isArray(cohorts)) {
            check(new Set(cohorts.map(c => c?.id)).size === cohorts.length,`${label}: повторные выборки запросов.`);
            const ids = new Set(snapshots.flatMap(s => (s.rows || []).map(r => r.id)));
            for (const c of cohorts) check(c && typeof c.id === 'string' && c.id.trim() && c.id !== 'all' && typeof c.label === 'string' && c.label.trim() && Array.isArray(c.queryIds) && c.queryIds.length > 0 && new Set(c.queryIds).size === c.queryIds.length && c.queryIds.every(id => typeof id === 'string' && ids.has(id)),`${label}: неверный состав выборки запросов.`);
          }
        }
        if (report.rankings.before && report.rankings.after) check(report.rankings.before.date < report.rankings.after.date, `${label}: неверный порядок дат.`);
        if (report.rankings.start) check(report.rankings.start.date <= (report.rankings.before?.date || report.rankings.after?.date || report.rankings.start.date), `${label}: первый замер позже отчётного периода.`);
      }
      if (report.traffic) {
        const t = report.traffic;
        check(Number.isInteger(t.visits) && t.visits >= 0, `${label}: неверное число визитов.`);
        if (['coverage','periods','weeks','csv','attribution'].some(k => own(t,k))) {
          const day = date => validDate(date) ? Date.parse(date+'T00:00:00Z') / 86400000 : NaN;
          const validPeriod = p => !!p && validDate(p.from) && validDate(p.to) && p.from <= p.to && ['total','yandex','google','other'].every(k => Number.isInteger(p[k]) && p[k] >= 0) && p.total === p.yandex + p.google + p.other;
          const before = t.periods?.before, after = t.periods?.after;
          check(validDate(t.coverage?.from) && validDate(t.coverage?.to) && t.coverage.from <= t.coverage.to,`${label}: неверный период трафика.`);
          check(typeof t.attribution === 'string' && t.attribution.trim(),`${label}: отсутствует атрибуция трафика.`);
          check(typeof t.csv === 'string' && t.csv.startsWith('evidence/') && /\.csv$/.test(t.csv) && safeHref(t.csv) === t.csv,`${label}: неверное приложение трафика.`);
          check(validPeriod(before) && validPeriod(after),`${label}: неверные итоги сравнения трафика.`);
          if (validPeriod(before) && validPeriod(after)) {
            check(day(before.to) + 1 === day(after.from) && day(before.to) - day(before.from) === day(after.to) - day(after.from),`${label}: периоды трафика должны быть последовательными и одинаковой длины.`);
            check(t.visits === after.total,`${label}: число визитов не совпадает с текущим периодом.`);
          }
          check(Array.isArray(t.weeks) && t.weeks.length > 0,`${label}: нет недельной истории трафика.`);
          if (Array.isArray(t.weeks) && t.weeks.length) {
            for (let i=0;i<t.weeks.length;i++) {
              const w = t.weeks[i];
              check(validPeriod(w) && day(w.to) - day(w.from) === 6,`${label}: неверная полная неделя трафика.`);
              if (i) check(day(t.weeks[i-1].to) + 1 === day(w.from),`${label}: пропуск или пересечение недель трафика.`);
            }
            check(t.weeks[0].from === t.coverage?.from && t.weeks.at(-1).to === t.coverage?.to,`${label}: границы недель не совпадают с покрытием трафика.`);
            for (const p of [before,after].filter(validPeriod)) {
              const included = t.weeks.filter(w => w.from >= p.from && w.to <= p.to);
              check(included[0]?.from === p.from && included.at(-1)?.to === p.to && ['total','yandex','google','other'].every(k => included.reduce((sum,w) => sum + w[k],0) === p[k]),`${label}: итог периода трафика не совпадает с неделями.`);
            }
          }
        }
      }
      check(Array.isArray(report.works), `${label}: отсутствует список работ.`);
      check(new Set((report.works || []).map(w => w.id)).size === report.works?.length, `${label}: повторные работы.`);
      for (const work of report.works || []) {
        check(['id','title','summary','result'].every(k => typeof work[k] === 'string' && work[k].trim()), `${label}: неполная работа.`);
        check(work.why === null || typeof work.why === 'string', `${label}: неверное пояснение работы.`);
        if (own(work,'retainedEvidence')) check(Array.isArray(work.retainedEvidence) && work.retainedEvidence.every(url => typeof url === 'string' && url.startsWith('evidence/') && safeHref(url) === url), `${label}: неверный путь сохранённого подтверждения.`);
        for (const section of work.sections || []) {
          const validSection = !!section && typeof section === 'object' && !Array.isArray(section);
          check(validSection, `${label}: неверный раздел работы.`);
          if (!validSection) continue;
          if (own(section,'title')) check(typeof section.title === 'string', `${label}: неверный заголовок раздела.`);
          if (own(section,'afterText')) check(typeof section.afterText === 'string', `${label}: неверный текст после таблицы.`);
          if (own(section,'note')) check(typeof section.note === 'string', `${label}: неверное примечание раздела.`);
          if (own(section,'table')) {
            const table = section.table;
            const validColumns = Array.isArray(table?.columns) && table.columns.length > 0 && table.columns.every(column => typeof column === 'string' && column.trim());
            const validRows = Array.isArray(table?.rows) && table.rows.every(row => Array.isArray(row) && row.length === table.columns?.length && row.every(cell => typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell))));
            check(!!table && typeof table === 'object' && !Array.isArray(table) && validColumns && validRows, `${label}: неверная таблица раздела.`);
            if (table && own(table,'label')) check(typeof table.label === 'string', `${label}: неверная подпись таблицы.`);
          }
          for (const link of section.links || []) check(!!safeHref(link.url), `${label}: небезопасная ссылка.`);
        }
        for (const evidence of work.evidence || []) {
          if (own(evidence,'text')) check(typeof evidence.text === 'string', `${label}: неверное описание подтверждения.`);
          check(['link','comparison','table'].includes(evidence.type), `${label}: неизвестное подтверждение.`);
          if (evidence.type === 'link') check(!!safeHref(evidence.url), `${label}: небезопасное подтверждение.`);
          if (evidence.type === 'comparison' && (own(evidence,'beforeImage') || own(evidence,'afterImage'))) {
            check(!!safeImageHref(evidence.beforeImage) && !!safeImageHref(evidence.afterImage), `${label}: сравнение должно содержать два изображения внутри evidence.`);
            check(['beforeAlt','afterAlt'].every(key => typeof evidence[key] === 'string' && evidence[key].trim()), `${label}: у снимков отсутствует описание.`);
          }
        }
      }
    }
    return errors;
  }
  return {ENGINES, months, monthLabel, getReport, defaultMonth, safeHref, safeImageHref, validDate, normalize, displayRank, rankChange, comparisonSettings, rankingsView, filterRows, validateData};
});
