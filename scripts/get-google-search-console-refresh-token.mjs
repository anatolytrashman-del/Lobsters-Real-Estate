// Разовый локальный скрипт: получает refresh token для доступа к Google
// Search Console API (read-only) от имени вашего аккаунта. Запускать один
// раз НА СВОЕЙ машине (не в GitHub Actions, не в песочнице Claude — нужен
// настоящий браузер и логин в Google). Результат — вставить в базу через
// Supabase Management API (сессия Claude сделает это сама, вам нужно
// только прислать значения в чат) в таблицу external_api_tokens,
// service='google_search_console'.
//
// Использование (те же CLIENT_ID/CLIENT_SECRET, что уже в Vercel для
// GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET — тот же Google Cloud
// проект и тот же OAuth-клиент, что и у генерации документов, просто
// новый refresh token с другим, более узким scope. Если у этого OAuth-
// клиента в Google Cloud Console ещё не включён "Google Search Console
// API" — включить его сначала (APIs & Services → Library → Search Console
// API → Enable), иначе ниже будет 403 access_denied):
//
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/get-google-search-console-refresh-token.mjs
//
// ВАЖНО: аккаунт, под которым логинитесь на открывшейся странице Google,
// должен быть именно тем, под которым добавлен и подтверждён сайт
// redevelopment.pro в Google Search Console (search.google.com/search-console)
// — иначе скрипт синка потом не найдёт подтверждённое свойство. Если сайт
// в Search Console ещё не добавлен/не подтверждён вовсе — сначала сделать
// это на search.google.com/search-console, токен без этого бесполезен.

import http from 'node:http';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const PORT = 53683;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Задайте GOOGLE_OAUTH_CLIENT_ID и GOOGLE_OAUTH_CLIENT_SECRET перед запуском.');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');
authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/webmasters.readonly');

console.log('\nОткройте эту ссылку в браузере и войдите под аккаунтом, у которого есть доступ');
console.log('к redevelopment.pro в Google Search Console:\n');
console.log(authUrl.toString());
console.log('\nЖду авторизации...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400);
    res.end('Нет кода авторизации в ответе Google.');
    return;
  }

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenResp.json();

  if (tokens.refresh_token) {
    console.log('\nГотово! Ваш refresh token для Search Console:\n');
    console.log(tokens.refresh_token);
    console.log(
      '\nПришлите его (можно прямо в чат Claude) вместе с CLIENT_ID/CLIENT_SECRET, ' +
        'которые вы только что использовали — сессия сама запишет их в базу.\n',
    );
    res.end('Авторизация прошла успешно, можно закрыть эту вкладку. Refresh token выведен в терминал.');
  } else {
    console.error('Не получили refresh_token. Ответ Google:', tokens);
    res.end('Ошибка — смотрите терминал, где запущен скрипт.');
  }

  server.close();
});

server.listen(PORT);
