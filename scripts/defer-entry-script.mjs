// PAGESPEED_PLAN.md, Э7-4 — главный JS подключается ПОСЛЕ первого
// отрисованного кадра, а не из <head>.
//
// Зачем. Публичные страницы отдаются пререндер-снапшотом (scripts/
// prerender.mjs): весь контент, включая LCP-картинку, уже лежит в HTML и
// браузеру нечего ждать, кроме CSS. Но Vite ставит <script type="module">
// в <head>, и на быстрой сети (в т.ч. у бота PageSpeed, который грузит
// страницу без троттлинга, а замедление досчитывает потом по модели)
// 160+ КБ JS успевали скачаться и выполниться РАНЬШЕ, чем браузер успевал
// отрисовать уже готовый снапшот. Дальше React (`createRoot`, не
// гидратация) сносил снапшот и строил DOM заново — и первой видимой
// отрисовкой становилась уже React-версия, то есть в замере FCP/LCP
// оказывались привязаны к загрузке и выполнению всего бандла: LCP 4-5 с,
// "Element render delay" ~2 000 мс, хотя сама картинка была загружена к
// 450 мс. Воспроизведено локально на реплике прода (Lighthouse на dist +
// прод-снапшот): та же страница без JS вовсе — Performance 97, с JS в
// <head> — 73, с JS после первого кадра — 92. Гидратация вместо
// createRoot не спасает: снапшот снят с уже пришедшими данными Supabase,
// а первый клиентский рендер их ещё не имеет — React при таком
// расхождении так же пересобирает дерево целиком.
//
// Что делает. Из dist/index.html вынимаются все <script type="module"
// src="/assets/…"> и <link rel="modulepreload"> и заменяются одним
// инлайн-лоадером в конце <body>: два requestAnimationFrame подряд =
// первый кадр уже нарисован, затем ожидание картинки первого экрана
// (точный порядок — в комментарии над самим лоадером ниже), после этого
// те же теги добавляются в DOM (modulepreload'ы — чтобы чанки по-прежнему
// грузились параллельно, а не по цепочке импортов). Страховка setTimeout —
// для фоновой вкладки, где rAF не тикает до её показа. Для пустого
// SPA-шелла (админка, страницы без снапшота) это стоит ~2 кадра задержки
// JS — не заметно (проверено: /admin получает JS через ~65 мс после
// начала загрузки на локальном сервере).
//
// Вставленные лоадером теги помечены data-entry-injected: prerender.mjs
// снимает снапшот через page.content() и обязан их удалить перед записью,
// иначе в сохранённом HTML модуль окажется подключён напрямую (сразу, из
// разметки) и весь смысл отложенной загрузки пропадёт, а лоадер вставит
// его второй раз. Сам лоадер помечен data-entry-loader (ищется
// prerender.mjs/тестами по этому атрибуту).
//
// Запускается в цепочке `npm run build` сразу после `vite build`, до
// копирования dist/index.html в 404.html и остальные статические шеллы
// (generate-*-preview-html.mjs) — все они наследуют уже отложенное
// подключение.
import { readFileSync, writeFileSync } from 'node:fs';

const INDEX_PATH = 'dist/index.html';

const html = readFileSync(INDEX_PATH, 'utf8');

const scriptRe = /\s*<script type="module"[^>]*\bsrc="(\/assets\/[^"]+)"[^>]*><\/script>/g;
const preloadRe = /\s*<link rel="modulepreload"[^>]*\bhref="(\/assets\/[^"]+)"[^>]*>/g;

const scripts = [...html.matchAll(scriptRe)].map((m) => m[1]);
const preloads = [...html.matchAll(preloadRe)].map((m) => m[1]);

if (scripts.length === 0) {
  throw new Error('[defer-entry-script] в dist/index.html не найден <script type="module" src="/assets/…"> — формат вывода Vite изменился?');
}
if (html.includes('data-entry-loader')) {
  throw new Error('[defer-entry-script] dist/index.html уже содержит лоадер — скрипт запущен дважды?');
}

// Инлайн без внешних зависимостей и без ES2015+ синтаксиса — выполняется
// до загрузки чего бы то ни было, в любом браузере, который вообще
// откроет страницу.
// Порядок ожидания: два кадра (снапшот на экране) → картинка первого
// экрана, если она есть в снапшоте (img[fetchpriority="high"] ставит
// HeroImageSlider), загружена и декодирована → браузер отчитался, что
// отрисовал именно её (запись largest-contentful-paint с её url; там,
// где PerformanceObserver таких записей не даёт — Safari, — или если
// картинка не крупнейший элемент экрана, ждём не дольше 600 мс после
// декодирования) → подключаем JS. Так бандл не конкурирует с
// LCP-картинкой за сеть на медленном соединении и не попадает в её
// критический путь в модели Lighthouse (на быстрой сети без этого
// ожидания чанки успевали докачаться до кадра с картинкой — проверено
// локальной репликой). Общий предохранитель — 3,5 с с момента выполнения
// лоадера: битая картинка/фоновая вкладка не оставят страницу без JS.
const loader = `<script data-entry-loader>(function(){var done=false;function inject(){if(done){return;}done=true;var head=document.head;${JSON.stringify(preloads)}.forEach(function(href){var l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href=href;l.setAttribute('data-entry-injected','');head.appendChild(l);});${JSON.stringify(scripts)}.forEach(function(src){var s=document.createElement('script');s.type='module';s.crossOrigin='';s.src=src;s.setAttribute('data-entry-injected','');document.body.appendChild(s);});}
function afterPaintOf(img){var fired=false;var go=function(){if(fired){return;}fired=true;requestAnimationFrame(inject);};var url=img.currentSrc||img.src;try{if(!('PerformanceObserver' in window)||PerformanceObserver.supportedEntryTypes.indexOf('largest-contentful-paint')===-1){go();return;}var po=new PerformanceObserver(function(list){var es=list.getEntries();for(var i=0;i<es.length;i++){if(es[i].url===url||es[i].element===img){po.disconnect();go();return;}}});po.observe({type:'largest-contentful-paint',buffered:true});setTimeout(function(){po.disconnect();go();},600);}catch(e){go();}}
function afterLcpImage(){var img=document.querySelector('#root img[fetchpriority="high"]');if(!img){inject();return;}var go=function(){afterPaintOf(img);};var decode=function(){if(img.decode){img.decode().then(go,go);}else{go();}};if(img.complete){decode();}else{img.addEventListener('load',decode,{once:true});img.addEventListener('error',function(){requestAnimationFrame(inject);},{once:true});}}
requestAnimationFrame(function(){requestAnimationFrame(afterLcpImage);});setTimeout(inject,3500);})();</script>`;

const output = html.replace(scriptRe, '').replace(preloadRe, '').replace('</body>', `${loader}\n  </body>`);

if (!output.includes(loader)) {
  throw new Error('[defer-entry-script] не нашёл </body> в dist/index.html, лоадер не вставлен');
}

writeFileSync(INDEX_PATH, output);
console.log(`[defer-entry-script] ${scripts.length} script + ${preloads.length} modulepreload вынесены в лоадер после первого кадра`);
