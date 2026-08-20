/**
 * Cloudflare Worker - 金山在线文档浏览器通用代理网关
 * 
 * 功能亮点：
 * 1. 🔗 支持 URL 拼接直接访问：
 *    格式：https://<你的Worker域名>/https://www.kdocs.cn/l/xxxxxx
 * 2. 🖥️ 自带现代化极简 Web 门户：直接访问根路径展示输入框，粘贴任意金山链接一键直达！
 * 3. 🔄 智能相对资源重定向：自动通过 Referer / Cookie 锁定目标 Host，无缝加载各类 JS、CSS、图片与 API。
 * 4. 🍪 完整的 Cookie 与 Location 重写：支持登录状态保持、跨域鉴权与 302 重定向重写。
 * 5. ⚡ WebSocket 实时协作代理：支持多人在智能表格中实时协同编辑。
 * 
 * 部署步骤：
 * 1. 登录 Cloudflare 控制台 (https://dash.cloudflare.com)
 * 2. Workers & Pages -> Create Application -> Create Worker (如命名为 kdocs-web)
 * 3. 点击 Edit code，全选覆盖粘贴本代码，点击 Deploy
 * 4. 浏览器打开分配的 Worker 域名即可使用！
 */

const DEFAULT_TARGET_HOST = "www.kdocs.cn";

export default {
  async fetch(request, env, ctx) {
    const requestUrl = new URL(request.url);
    const workerOrigin = requestUrl.origin;

    // 1. 如果是首页且无参数，返回美观的前端输入门户
    if (requestUrl.pathname === "/" && !requestUrl.searchParams.has("url")) {
      return renderPortalPage(workerOrigin);
    }

    // 2. 解析实际的目标 URL
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

    // 3. 处理 WebSocket 协同升级请求 (实时在线表格编辑)
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      return handleWebSocket(request, targetUrl);
    }

    // 4. 处理 CORS OPTIONS 预检
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

    // 5. 构造转发请求头
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetUrl.host);
    newHeaders.set("Origin", targetUrl.origin);
    newHeaders.set("Referer", targetUrl.toString());

    // 移除导致反向代理问题的部分专有头
    newHeaders.delete("cf-connecting-ip");
    newHeaders.delete("cf-ipcountry");
    newHeaders.delete("cf-ray");
    newHeaders.delete("cf-visitor");

    const proxyRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers: newHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual", // 手动处理 301/302 重定向
    });

    try {
      const response = await fetch(proxyRequest);

      // 6. 构造客户端响应，重写 Headers (Location / Set-Cookie / CORS)
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
          // 清理 domain 限制，使 cookie 作用于当前 proxy 域
          const rewrittenCookie = cookie
            .replace(/domain=[^;]+;?/gi, "")
            .replace(/SameSite=None/gi, "SameSite=Lax");
          modifiedHeaders.append("Set-Cookie", rewrittenCookie);
        }
      }

      // 允许在 iframe 中展示（移除 frame 限制）
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

/**
 * 提取目标 URL
 */
function extractTargetUrl(requestUrl, request) {
  // 方式 A：通过 query 参数 ?url=...
  if (requestUrl.searchParams.has("url")) {
    return requestUrl.searchParams.get("url");
  }

  // 方式 B：通过路径前缀提取 https://worker.dev/https://www.kdocs.cn/xxx
  let pathname = requestUrl.pathname.slice(1); // 去掉开头的 /
  if (pathname.startsWith("http://") || pathname.startsWith("https://")) {
    return pathname + requestUrl.search;
  }
  if (pathname.startsWith("http:/") && !pathname.startsWith("http://")) {
    return pathname.replace("http:/", "http://") + requestUrl.search;
  }
  if (pathname.startsWith("https:/") && !pathname.startsWith("https://")) {
    return pathname.replace("https:/", "https://") + requestUrl.search;
  }

  // 方式 C：相对静态资源/接口，通过 Referer 智能回推源站 Host
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      // 如果 referer 是代理地址（如 https://worker.dev/https://www.kdocs.cn/...）
      const extractedHost = extractHostFromReferer(refUrl);
      if (extractedHost) {
        return `https://${extractedHost}${requestUrl.pathname}${requestUrl.search}`;
      }
    } catch {}
  }

  // 方式 D：默认 fallback 到金山官方域名
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

/**
 * WebSocket 转发支持
 */
async function handleWebSocket(request, targetUrl) {
  const wsUrl = new URL(targetUrl);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

  const newHeaders = new Headers(request.headers);
  newHeaders.set("Host", wsUrl.host);

  return fetch(wsUrl.toString(), {
    headers: newHeaders,
  });
}

/**
 * 现代极简 Web 门户页面
 */
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
      margin-bottom: 20px;
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
    <div class="badge">🚀 Cloudflare 加速代理</div>
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
