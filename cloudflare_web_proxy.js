/**
 * Cloudflare Worker - 金山在线文档浏览器代理网关（带安全认证防护版）
 * 
 * 🛡️ 认证与防滥用机制：
 * 1. 🔑 密码保护：首次访问需输入访问密码，验证通过后发放安全 Cookie（有效期 30 天，免重复登录）；
 * 2. ⚡ 动静全链路鉴权：支持 WebSocket 协同、静态资源加载及子请求携带 Cookie 自动放行；
 * 3. 🤖 API 友好兼容：支持在 Header 中携带 `X-Proxy-Auth` 或参数 `?auth_key=` 认证；
 * 4. ⚙️ 支持 Cloudflare 环境变量：可在 Worker 控制台「Settings -> Variables」中配置 `PROXY_PASSWORD`，安全无感。
 * 
 * 部署步骤：
 * 1. 登录 Cloudflare 控制台 (https://dash.cloudflare.com)
 * 2. 进入 Worker -> Edit code，覆盖粘贴本代码并点击 Deploy
 * 3. （推荐）在 Worker 的 Settings -> Variables 中添加环境变量 PROXY_PASSWORD，设置你的专属密码
 *    （若未设置环境变量，则默认使用代码中的 DEFAULT_PASSWORD）
 */

// 默认备用访问密码（建议在 Cloudflare 环境变量 PROXY_PASSWORD 中配置）
const DEFAULT_PASSWORD = "MySecretPassword2026";
const DEFAULT_TARGET_HOST = "www.kdocs.cn";
const AUTH_COOKIE_NAME = "_kdocs_proxy_auth";

export default {
  async fetch(request, env, ctx) {
    const requestUrl = new URL(request.url);
    const workerOrigin = requestUrl.origin;
    const correctPassword = (env && env.PROXY_PASSWORD) || DEFAULT_PASSWORD;

    // ==================== 1. 认证状态检查 ====================
    // 处理登录表单提交请求 POST /__proxy_login__
    if (requestUrl.pathname === "/__proxy_login__" && request.method === "POST") {
      return handleLoginSubmit(request, requestUrl, correctPassword);
    }

    // 处理退出登录 GET /__proxy_logout__
    if (requestUrl.pathname === "/__proxy_logout__") {
      return handleLogout(requestUrl);
    }

    // 校验当前请求是否已通过认证
    const isAuthenticated = checkAuthentication(request, requestUrl, correctPassword);

    if (!isAuthenticated) {
      // 若未认证且为静态资源请求，返回 401
      if (isStaticOrApiRequest(requestUrl)) {
        return new Response("Unauthorized: 请先登录认证代理网关", {
          status: 401,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      // 否则展示现代毛玻璃登录验证页面
      return renderLoginPage(requestUrl, workerOrigin);
    }

    // ==================== 2. 正常代理逻辑 ====================
    // 如果是首页且无目标参数，展示已登录的 Web 导航门户
    if (requestUrl.pathname === "/" && !requestUrl.searchParams.has("url")) {
      return renderPortalPage(workerOrigin);
    }

    // 解析目标 URL
    let targetUrlStr = extractTargetUrl(requestUrl, request);
    if (!targetUrlStr) {
      return new Response("无效的目标 URL 请求", { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch (e) {
      return new Response("无法解析目标 URL: " + targetUrlStr, { status: 400 });
    }

    // 处理 WebSocket 协同升级请求
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      return handleWebSocket(request, targetUrl);
    }

    // 处理 CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // 构造转发请求头
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetUrl.host);
    newHeaders.set("Origin", targetUrl.origin);
    newHeaders.set("Referer", targetUrl.toString());

    newHeaders.delete("cf-connecting-ip");
    newHeaders.delete("cf-ipcountry");
    newHeaders.delete("cf-ray");
    newHeaders.delete("cf-visitor");

    const proxyRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers: newHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });

    try {
      const response = await fetch(proxyRequest);

      // 重写响应头
      const modifiedHeaders = new Headers(response.headers);
      modifiedHeaders.set("Access-Control-Allow-Origin": "*");
      modifiedHeaders.set("Access-Control-Allow-Credentials": "true");

      // 重写 301 / 302 重定向目标
      const location = modifiedHeaders.get("Location");
      if (location) {
        let redirectTarget;
        try {
          redirectTarget = new URL(location, targetUrl.origin).toString();
        } catch {
          redirectTarget = location;
        }
        modifiedHeaders.set("Location", `${workerOrigin}/${redirectTarget}`);
      }

      // 重写 Set-Cookie 域
      const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      if (cookies.length > 0) {
        modifiedHeaders.delete("Set-Cookie");
        for (const cookie of cookies) {
          const rewrittenCookie = cookie
            .replace(/domain=[^;]+;?/gi, "")
            .replace(/SameSite=None/gi, "SameSite=Lax");
          modifiedHeaders.append("Set-Cookie", rewrittenCookie);
        }
      }

      modifiedHeaders.delete("X-Frame-Options");
      modifiedHeaders.delete("Content-Security-Policy");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: modifiedHeaders,
      });
    } catch (err) {
      return new Response("代理访问金山在线文档失败: " + err.message, {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};

// ==================== 认证辅助逻辑 ====================

function checkAuthentication(request, requestUrl, correctPassword) {
  // 1. 通过请求头 X-Proxy-Auth 认证（适用于 API 客户端）
  const headerAuth = request.headers.get("X-Proxy-Auth");
  if (headerAuth && headerAuth === correctPassword) {
    return true;
  }

  // 2. 通过 URL 参数 ?auth_key= 认证
  const queryAuth = requestUrl.searchParams.get("auth_key");
  if (queryAuth && queryAuth === correctPassword) {
    return true;
  }

  // 3. 通过 Cookie 认证
  const cookieHeader = request.headers.get("Cookie") || "";
  const token = getCookieValue(cookieHeader, AUTH_COOKIE_NAME);
  if (token && token === generateToken(correctPassword)) {
    return true;
  }

  return false;
}

function generateToken(password) {
  // 基于密码生成简易校验签名
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    hash = (hash << 5) - hash + password.charCodeAt(i);
    hash |= 0;
  }
  return "auth_" + Math.abs(hash).toString(36);
}

function getCookieValue(cookieString, name) {
  const match = cookieString.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[2]) : null;
}

async function handleLoginSubmit(request, requestUrl, correctPassword) {
  let passwordInput = "";
  let redirectUrl = "/";

  try {
    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      passwordInput = formData.get("password") || "";
      redirectUrl = formData.get("redirect") || "/";
    } else {
      const json = await request.json();
      passwordInput = json.password || "";
      redirectUrl = json.redirect || "/";
    }
  } catch {}

  if (passwordInput === correctPassword) {
    const token = generateToken(correctPassword);
    // 写入 30 天有效期的授权 Cookie
    const maxAge = 30 * 24 * 60 * 60;
    const cookieHeader = `${AUTH_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly; Secure`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl,
        "Set-Cookie": cookieHeader,
      },
    });
  } else {
    // 密码错误，返回带错误提示的登录页
    const workerOrigin = requestUrl.origin;
    return renderLoginPage(requestUrl, workerOrigin, "❌ 密码错误，请重新输入！", redirectUrl);
  }
}

function handleLogout(requestUrl) {
  // 清理 Cookie
  const cookieHeader = `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": cookieHeader,
    },
  });
}

function isStaticOrApiRequest(url) {
  const path = url.pathname.toLowerCase();
  return (
    path.endsWith(".js") ||
    path.endsWith(".css") ||
    path.endsWith(".png") ||
    path.endsWith(".jpg") ||
    path.endsWith(".svg") ||
    path.endsWith(".woff2") ||
    path.startsWith("/api/")
  );
}

// ==================== URL 解析与代理 ====================

function extractTargetUrl(requestUrl, request) {
  if (requestUrl.searchParams.has("url")) {
    return requestUrl.searchParams.get("url");
  }

  let pathname = requestUrl.pathname.slice(1);
  if (pathname.startsWith("http://") || pathname.startsWith("https://")) {
    return pathname + requestUrl.search;
  }
  if (pathname.startsWith("http:/") && !pathname.startsWith("http://")) {
    return pathname.replace("http:/", "http://") + requestUrl.search;
  }
  if (pathname.startsWith("https:/") && !pathname.startsWith("https://")) {
    return pathname.replace("https:/", "https://") + requestUrl.search;
  }

  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const extractedHost = extractHostFromReferer(refUrl);
      if (extractedHost) {
        return `https://${extractedHost}${requestUrl.pathname}${requestUrl.search}`;
      }
    } catch {}
  }

  return `https://${DEFAULT_TARGET_HOST}${requestUrl.pathname}${requestUrl.search}`;
}

function extractHostFromReferer(refUrl) {
  let p = refUrl.pathname.slice(1);
  if (p.startsWith("http://") || p.startsWith("https://")) {
    try {
      return new URL(p).host;
    } catch {}
  }
  return DEFAULT_TARGET_HOST;
}

async function handleWebSocket(request, targetUrl) {
  const wsUrl = new URL(targetUrl);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

  const newHeaders = new Headers(request.headers);
  newHeaders.set("Host", wsUrl.host);

  return fetch(wsUrl.toString(), {
    headers: newHeaders,
  });
}

// ==================== UI 界面渲染 ====================

function renderLoginPage(requestUrl, workerOrigin, errorMsg = "", targetRedirect = "") {
  const redirectTarget = targetRedirect || requestUrl.pathname + requestUrl.search;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>安全认证 - 金山文档代理网关</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 30, 46, 0.85);
      --border: rgba(255, 255, 255, 0.1);
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at 50% 10%, #1e293b 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 36px 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
      text-align: center;
    }
    .icon {
      width: 56px;
      height: 56px;
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      color: #60a5fa;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    p {
      color: var(--text-muted);
      font-size: 13.5px;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .error-box {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 20px;
      text-align: left;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .input-field {
      width: 100%;
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 14px 16px;
      color: #fff;
      font-size: 15px;
      outline: none;
      transition: all 0.2s;
    }
    .input-field:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
    }
    .btn {
      background: linear-gradient(135deg, var(--accent), var(--accent-hover));
      color: #fff;
      border: none;
      border-radius: 12px;
      padding: 14px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn:hover {
      opacity: 0.92;
      transform: translateY(-1px);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
    </div>
    <h1>访问权限验证</h1>
    <p>该网关服务受密码保护，请输入访问密码以继续使用金山在线文档代理。</p>

    ${errorMsg ? `<div class="error-box">${errorMsg}</div>` : ""}

    <form action="/__proxy_login__" method="POST">
      <input type="hidden" name="redirect" value="${redirectTarget}" />
      <input type="password" name="password" class="input-field" placeholder="请输入专属访问密码..." required autofocus />
      <button type="submit" class="btn">验证并进入</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function renderPortalPage(workerOrigin) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>金山在线文档 - 浏览器代理访问网关</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 30, 46, 0.75);
      --border: rgba(255, 255, 255, 0.08);
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at 50% 10%, #1e293b 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      width: 100%;
      max-width: 640px;
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
    }
    .logout-btn {
      color: var(--text-muted);
      font-size: 12.5px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: color 0.2s;
    }
    .logout-btn:hover {
      color: #f87171;
    }
    h1 {
      font-size: 26px;
      font-weight: 700;
      margin-bottom: 8px;
      background: linear-gradient(to right, #ffffff, #93c5fd);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.desc {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    .input-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .input-box {
      width: 100%;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 14px 18px;
      color: #fff;
      font-size: 15px;
      outline: none;
      transition: all 0.2s;
    }
    .input-box:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
    }
    .btn {
      background: linear-gradient(135deg, var(--accent), var(--accent-hover));
      color: #fff;
      border: none;
      border-radius: 12px;
      padding: 14px 24px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .btn:hover {
      opacity: 0.92;
      transform: translateY(-1px);
    }
    .tips {
      margin-top: 30px;
      border-top: 1px solid var(--border);
      padding-top: 20px;
    }
    .tips-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    .tips-code {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 10px 14px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      color: #38bdf8;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-bar">
      <div class="badge">🛡️ 已通过认证 | 安全代理</div>
      <a href="/__proxy_logout__" class="logout-btn">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
        <span>退出登录</span>
      </a>
    </div>

    <h1>金山在线文档浏览器代理网关</h1>
    <p class="desc">专为企业局域网/网络受限环境设计，粘贴任意金山文档（智能表格/文字/演示）链接，一键穿透直达！</p>
    
    <div class="input-group">
      <input type="text" id="docUrl" class="input-box" placeholder="粘贴金山文档链接，如 https://www.kdocs.cn/l/co63t9c3u9Q3" />
      <button class="btn" onclick="openProxy()">
        <span>立即前往访问</span>
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
      </button>
    </div>

    <div class="tips">
      <div class="tips-title">💡 快捷书签使用方法：</div>
      <div class="tips-code">${workerOrigin}/https://www.kdocs.cn/l/你的表格ID</div>
    </div>
  </div>

  <script>
    function openProxy() {
      var val = document.getElementById("docUrl").value.trim();
      if (!val) {
        alert("请先粘贴金山文档完整 URL 链接！");
        return;
      }
      if (!val.startsWith("http://") && !val.startsWith("https://")) {
        val = "https://" + val;
      }
      window.location.href = "${workerOrigin}/" + val;
    }
    document.getElementById("docUrl").addEventListener("keypress", function(e) {
      if (e.key === "Enter") openProxy();
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
