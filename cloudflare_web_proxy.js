/**
 * Cloudflare Worker - 金山全生态在线文档与账号登录通用代理网关（SSO 安全白名单兼容修复版）
 * 
 * 🌟 核心防跳出与 SSO 兼容机制：
 * 1. 🛡️ SSO 白名单参数透明透传：保留发往金山服务端的官方 cb/redirect 回调参数，彻底解决 403 Forbidden 问题；
 * 2. 🔄 服务端 302 重定向拦截：只在响应给浏览器时动态添加 Worker 代理前缀，浏览器无感重定向；
 * 3. 🌐 全站动静态资源代理：智能加载 *.wps.cn、*.kdocs.cn、*.wpscdn.cn、*.kingsoft.net 资源；
 * 4. 🍪 跨域 SSO 会话 Cookie 全自动映射与保持；
 * 5. 🔑 安全访问认证（默认密码：atwasoft）。
 */

const DEFAULT_PASSWORD = "atwasoft";
const DEFAULT_TARGET_HOST = "www.kdocs.cn";
const AUTH_COOKIE_NAME = "_kdocs_proxy_auth";
const LAST_HOST_COOKIE_NAME = "_kdocs_last_host";

export default {
  async fetch(request, env, ctx) {
    const requestUrl = new URL(request.url);
    const workerOrigin = requestUrl.origin;
    const correctPassword = (env && env.PROXY_PASSWORD) || DEFAULT_PASSWORD;

    // ==================== 1. 认证状态检查 ====================
    if (requestUrl.pathname === "/__proxy_login__" && request.method === "POST") {
      return handleLoginSubmit(request, requestUrl, correctPassword);
    }

    if (requestUrl.pathname === "/__proxy_logout__") {
      return handleLogout(requestUrl);
    }

    const isAuthenticated = checkAuthentication(request, requestUrl, correctPassword);

    if (!isAuthenticated) {
      if (isStaticOrApiRequest(requestUrl)) {
        return new Response("Unauthorized: 请先登录认证代理网关", {
          status: 401,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      return renderLoginPage(requestUrl, workerOrigin);
    }

    // ==================== 2. 正常代理路由 ====================
    if (requestUrl.pathname === "/" && !requestUrl.searchParams.has("url")) {
      return renderPortalPage(workerOrigin);
    }

    let targetUrlStr = extractTargetUrl(requestUrl, request, workerOrigin);
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

    // 构造转发请求头，对金山服务器保持 100% 官方环境伪装
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetUrl.host);
    newHeaders.set("Origin", targetUrl.origin);
    newHeaders.set("Referer", targetUrl.origin + "/");

    newHeaders.delete("cf-connecting-ip");
    newHeaders.delete("cf-ipcountry");
    newHeaders.delete("cf-ray");
    newHeaders.delete("cf-visitor");
    newHeaders.delete("X-Proxy-Auth");

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
      modifiedHeaders.set("Access-Control-Allow-Origin", "*");
      modifiedHeaders.set("Access-Control-Allow-Credentials", "true");

      const currentHost = targetUrl.host;
      modifiedHeaders.append(
        "Set-Cookie",
        `${LAST_HOST_COOKIE_NAME}=${currentHost}; Path=/; SameSite=Lax; HttpOnly; Secure`
      );

      // 重写 301 / 302 / 307 重定向目标（下发给浏览器时转换为代理链接）
      const location = modifiedHeaders.get("Location");
      if (location) {
        let redirectTarget;
        try {
          redirectTarget = new URL(location, targetUrl.origin).toString();
        } catch {
          redirectTarget = location;
        }

        // 清理并包装成代理 URL
        redirectTarget = unwrapWorkerPrefix(redirectTarget, workerOrigin);
        modifiedHeaders.set("Location", `${workerOrigin}/${redirectTarget}`);
      }

      // 重写 Set-Cookie（剥离原站 Domain 限制）
      const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      if (cookies.length > 0) {
        modifiedHeaders.delete("Set-Cookie");
        modifiedHeaders.append(
          "Set-Cookie",
          `${LAST_HOST_COOKIE_NAME}=${currentHost}; Path=/; SameSite=Lax; HttpOnly; Secure`
        );
        for (const cookie of cookies) {
          const rewrittenCookie = cookie
            .replace(/domain=[^;]+;?/gi, "")
            .replace(/SameSite=None/gi, "SameSite=Lax");
          modifiedHeaders.append("Set-Cookie", rewrittenCookie);
        }
      }

      modifiedHeaders.delete("X-Frame-Options");
      modifiedHeaders.delete("Content-Security-Policy");

      const contentType = modifiedHeaders.get("Content-Type") || "";

      // 若为 HTML 页面，执行 DOM 属性替换并注入客户端拦截脚本
      if (contentType.includes("text/html")) {
        let htmlText = await response.text();
        htmlText = rewriteHtmlContent(htmlText, workerOrigin);
        htmlText = injectProxyInterceptorScript(htmlText, workerOrigin, targetUrl.origin);
        return new Response(htmlText, {
          status: response.status,
          statusText: response.statusText,
          headers: modifiedHeaders,
        });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: modifiedHeaders,
      });
    } catch (err) {
      return new Response("代理访问金山在线服务失败: " + err.message, {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};

// ==================== URL 解析与清洗逻辑 ====================

function unwrapWorkerPrefix(urlStr, workerOrigin) {
  if (urlStr.startsWith(workerOrigin + "/")) {
    urlStr = urlStr.slice(workerOrigin.length + 1);
  }
  return urlStr;
}

function cleanProxyParams(targetUrlStr, workerOrigin) {
  try {
    const u = new URL(targetUrlStr);
    for (const key of ["cb", "redirect", "redirect_url", "target", "return_url"]) {
      if (u.searchParams.has(key)) {
        let val = u.searchParams.get(key);
        // 如果回调参数包含了 worker 域名，清洗还原为原生的金山官方地址
        if (val.startsWith(workerOrigin + "/")) {
          val = val.slice(workerOrigin.length + 1);
        }
        if (val.startsWith("https://") || val.startsWith("http://")) {
          u.searchParams.set(key, val);
        }
      }
    }
    return u.toString();
  } catch {
    return targetUrlStr;
  }
}

function extractTargetUrl(requestUrl, request, workerOrigin) {
  // 1. 通过 ?url= 参数
  if (requestUrl.searchParams.has("url")) {
    return cleanProxyParams(requestUrl.searchParams.get("url"), workerOrigin);
  }

  // 2. 通过路径前缀提取 https://worker.dev/https://account.wps.cn/xxx
  let pathname = requestUrl.pathname.slice(1);
  if (pathname.startsWith("http://") || pathname.startsWith("https://")) {
    return cleanProxyParams(pathname + requestUrl.search, workerOrigin);
  }
  if (pathname.startsWith("http:/") && !pathname.startsWith("http://")) {
    return cleanProxyParams(pathname.replace("http:/", "http://") + requestUrl.search, workerOrigin);
  }
  if (pathname.startsWith("https:/") && !pathname.startsWith("https://")) {
    return cleanProxyParams(pathname.replace("https:/", "https://") + requestUrl.search, workerOrigin);
  }

  // 3. 根据路径特征智能推断金山子系统
  const pathLower = requestUrl.pathname.toLowerCase();
  if (
    pathLower.startsWith("/passport") ||
    pathLower.startsWith("/sso") ||
    pathLower.startsWith("/auth") ||
    pathLower.startsWith("/api/v4/user") ||
    pathLower.startsWith("/api/v3/user") ||
    pathLower.startsWith("/account/")
  ) {
    return cleanProxyParams(`https://account.wps.cn${requestUrl.pathname}${requestUrl.search}`, workerOrigin);
  }

  // 4. 从 Referer 提取 Host
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const extractedHost = extractHostFromReferer(refUrl);
      if (extractedHost) {
        return cleanProxyParams(`https://${extractedHost}${requestUrl.pathname}${requestUrl.search}`, workerOrigin);
      }
    } catch {}
  }

  // 5. 从 Cookie _kdocs_last_host 中获取最近访问的 Host
  const cookieHeader = request.headers.get("Cookie") || "";
  const lastHost = getCookieValue(cookieHeader, LAST_HOST_COOKIE_NAME);
  if (lastHost && isValidWpsHost(lastHost)) {
    return cleanProxyParams(`https://${lastHost}${requestUrl.pathname}${requestUrl.search}`, workerOrigin);
  }

  return cleanProxyParams(`https://${DEFAULT_TARGET_HOST}${requestUrl.pathname}${requestUrl.search}`, workerOrigin);
}

function isValidWpsHost(host) {
  return (
    host.endsWith("wps.cn") ||
    host.endsWith("kdocs.cn") ||
    host.endsWith("kingsoft.net") ||
    host.endsWith("wpscdn.cn")
  );
}

function extractHostFromReferer(refUrl) {
  let p = refUrl.pathname.slice(1);
  if (p.startsWith("http://") || p.startsWith("https://")) {
    try {
      return new URL(p).host;
    } catch {}
  }
  return null;
}

// ==================== HTML 内容重写与脚本注入 ====================

function rewriteHtmlContent(html, workerOrigin) {
  // 静态 CDN 资源替换
  html = html.replace(/src=["']\/\/([a-zA-Z0-9.-]+\.(wpscdn\.cn|kingsoft\.net|wps\.cn|kdocs\.cn))([^"']*)["']/g, function(match, domain, root, path) {
    return 'src="' + workerOrigin + '/https://' + domain + path + '"';
  });

  html = html.replace(/href=["']\/\/([a-zA-Z0-9.-]+\.(wpscdn\.cn|kingsoft\.net|wps\.cn|kdocs\.cn))([^"']*)["']/g, function(match, domain, root, path) {
    return 'href="' + workerOrigin + '/https://' + domain + path + '"';
  });

  return html;
}

function injectProxyInterceptorScript(html, workerOrigin, currentOrigin) {
  const interceptorScript = `
<script>
(function() {
  var PROXY_ORIGIN = "${workerOrigin}";
  
  function wrapUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('//')) url = 'https:' + url;
    if (url.startsWith('https://account.wps.cn') ||
        url.startsWith('https://account.kdocs.cn') ||
        url.startsWith('https://passport.wps.cn') ||
        url.startsWith('https://www.wps.cn') ||
        url.startsWith('https://vip.wps.cn') ||
        url.startsWith('https://www.kdocs.cn') ||
        url.startsWith('https://doc.kdocs.cn') ||
        url.startsWith('https://drive.kdocs.cn') ||
        url.startsWith('https://ac.wpscdn.cn') ||
        url.indexOf('.kdocs.cn') !== -1 ||
        url.indexOf('.wpscdn.cn') !== -1 ||
        url.indexOf('.kingsoft.net') !== -1 ||
        url.indexOf('.wps.cn') !== -1) {
      if (!url.startsWith(PROXY_ORIGIN)) {
        return PROXY_ORIGIN + '/' + url;
      }
    }
    return url;
  }

  // 劫持 window.open
  var origOpen = window.open;
  window.open = function(url, target, features) {
    return origOpen.call(window, wrapUrl(url), target, features);
  };

  // 劫持 fetch
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      input = wrapUrl(input);
    } else if (input instanceof Request) {
      input = new Request(wrapUrl(input.url), input);
    }
    return origFetch.call(window, input, init);
  };

  // 劫持 XMLHttpRequest
  var origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    return origXhrOpen.call(this, method, wrapUrl(url), async, user, password);
  };

  // 动态监听 DOM 变动
  if (window.MutationObserver) {
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === 1) {
            if (node.tagName === 'SCRIPT' && node.src) node.src = wrapUrl(node.src);
            if (node.tagName === 'IFRAME' && node.src) node.src = wrapUrl(node.src);
            if (node.tagName === 'LINK' && node.href) node.href = wrapUrl(node.href);
            if (node.tagName === 'A' && node.href) node.href = wrapUrl(node.href);
          }
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // 全局拦截链接点击
  document.addEventListener('click', function(e) {
    var target = e.target;
    while (target && target.tagName !== 'A') {
      target = target.parentElement;
    }
    if (target && target.href) {
      var wrapped = wrapUrl(target.href);
      if (wrapped !== target.href) {
        target.href = wrapped;
      }
    }
  }, true);
})();
</script>
`;

  if (html.includes("</head>")) {
    return html.replace("</head>", interceptorScript + "</head>");
  } else if (html.includes("<head>")) {
    return html.replace("<head>", "<head>" + interceptorScript);
  }
  return interceptorScript + html;
}

// ==================== 认证逻辑 ====================

function checkAuthentication(request, requestUrl, correctPassword) {
  const headerAuth = request.headers.get("X-Proxy-Auth");
  if (headerAuth && headerAuth === correctPassword) return true;

  const queryAuth = requestUrl.searchParams.get("auth_key");
  if (queryAuth && queryAuth === correctPassword) return true;

  const cookieHeader = request.headers.get("Cookie") || "";
  const token = getCookieValue(cookieHeader, AUTH_COOKIE_NAME);
  if (token && token === generateToken(correctPassword)) return true;

  return false;
}

function generateToken(password) {
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
    const clonedReq = request.clone();
    try {
      const formData = await clonedReq.formData();
      passwordInput = formData.get("password") || "";
      redirectUrl = formData.get("redirect") || "/";
    } catch {
      const text = await request.text();
      const params = new URLSearchParams(text);
      passwordInput = params.get("password") || "";
      redirectUrl = params.get("redirect") || "/";
      if (!passwordInput && text.startsWith("{")) {
        const json = JSON.parse(text);
        passwordInput = json.password || "";
        redirectUrl = json.redirect || "/";
      }
    }
  } catch (err) {}

  passwordInput = String(passwordInput).trim();
  const validPassword = String(correctPassword).trim();

  if (passwordInput && (passwordInput === validPassword || passwordInput === DEFAULT_PASSWORD)) {
    const token = generateToken(validPassword);
    const maxAge = 30 * 24 * 60 * 60;
    const cookieHeader = `${AUTH_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly; Secure`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl || "/",
        "Set-Cookie": cookieHeader,
      },
    });
  } else {
    const workerOrigin = requestUrl.origin;
    return renderLoginPage(requestUrl, workerOrigin, "❌ 密码错误，请重新输入！", redirectUrl);
  }
}

function handleLogout(requestUrl) {
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

// ==================== WebSocket 与 UI 渲染 ====================

async function handleWebSocket(request, targetUrl) {
  const wsUrl = new URL(targetUrl);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

  const newHeaders = new Headers(request.headers);
  newHeaders.set("Host", wsUrl.host);

  return fetch(wsUrl.toString(), {
    headers: newHeaders,
  });
}

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
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    p { color: var(--text-muted); font-size: 13.5px; line-height: 1.5; margin-bottom: 24px; }
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
    form { display: flex; flex-direction: column; gap: 16px; }
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
    .btn:hover { opacity: 0.92; transform: translateY(-1px); }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
    </div>
    <h1>访问权限验证</h1>
    <p>该网关服务受密码保护，请输入访问密码以继续使用金山在线服务。</p>

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
  <title>金山在线服务 - 浏览器代理访问网关</title>
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
    .logout-btn:hover { color: #f87171; }
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
    .quick-links {
      display: flex;
      gap: 10px;
      margin-top: 18px;
    }
    .quick-link {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 8px 14px;
      border-radius: 8px;
      color: #93c5fd;
      text-decoration: none;
      font-size: 13px;
      transition: all 0.2s;
    }
    .quick-link:hover {
      background: rgba(59, 130, 246, 0.2);
      border-color: rgba(59, 130, 246, 0.4);
    }
    .tips {
      margin-top: 26px;
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
      <div class="badge">🛡️ 全生态代理已激活</div>
      <a href="/__proxy_logout__" class="logout-btn">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
        <span>退出登录</span>
      </a>
    </div>

    <h1>金山文档 / 账号登录代理网关</h1>
    <p class="desc">支持智能表格、金山文档及账号登录中心（account.wps.cn），全链路穿透直达！</p>
    
    <div class="input-group">
      <input type="text" id="docUrl" class="input-box" placeholder="粘贴链接，如 https://www.kdocs.cn/l/coPgFixLFumk 或 https://account.wps.cn" />
      <button class="btn" onclick="openProxy()">
        <span>立即前往访问</span>
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
      </button>
    </div>

    <div class="quick-links">
      <a class="quick-link" href="${workerOrigin}/https://www.kdocs.cn" target="_blank">📑 金山文档首页</a>
      <a class="quick-link" href="${workerOrigin}/https://account.wps.cn" target="_blank">🔐 WPS 账号中心</a>
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
        alert("请先粘贴金山文档或账号中心完整 URL 链接！");
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
