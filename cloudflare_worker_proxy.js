/**
 * Cloudflare Worker - WPS AirScript 2.0 API 反向代理脚本（带安全认证防护版）
 * 
 * 🛡️ 安全防滥用机制：
 * 支持通过 Header `X-Proxy-Auth` 或 URL 参数 `?auth_key=` 校验访问密码。
 * 可在 Cloudflare Worker 控制台「Settings -> Variables」中配置 `PROXY_PASSWORD` 环境变量。
 * 
 * 用途：
 * 当公司内网/防火墙限制或封禁 www.kdocs.cn 时，通过 Cloudflare Worker 安全转发 API 请求。
 */

// 默认备用密码（建议在 Cloudflare 控制台环境变量 PROXY_PASSWORD 中配置）
const DEFAULT_PASSWORD = "atwasoft";

export default {
  async fetch(request, env, ctx) {
    const targetHost = "www.kdocs.cn";
    const url = new URL(request.url);
    const correctPassword = (env && env.PROXY_PASSWORD) || DEFAULT_PASSWORD;

    // 处理跨域预检请求 (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, AirScript-Token, Authorization, X-Proxy-Auth",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // ==================== 安全认证校验 ====================
    const headerAuth = request.headers.get("X-Proxy-Auth");
    const queryAuth = url.searchParams.get("auth_key");

    if (correctPassword && headerAuth !== correctPassword && queryAuth !== correctPassword) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Unauthorized: 代理网关认证失败，缺少有效密码 (可在 Header 中传递 X-Proxy-Auth 或 URL 携带 ?auth_key=)",
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // 构建转发到金山文档的目标 URL
    url.hostname = targetHost;
    url.protocol = "https:";
    url.port = "";

    // 复制并修改请求头
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetHost);
    newHeaders.set("Origin", `https://${targetHost}`);
    newHeaders.set("Referer", `https://${targetHost}/`);
    newHeaders.delete("X-Proxy-Auth");

    const proxyRequest = new Request(url.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: "follow",
    });

    try {
      const response = await fetch(proxyRequest);

      const modifiedResponse = new Response(response.body, response);
      modifiedResponse.headers.set("Access-Control-Allow-Origin", "*");
      modifiedResponse.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, AirScript-Token, Authorization, X-Proxy-Auth"
      );

      return modifiedResponse;
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Cloudflare Worker 代理请求金山文档失败: " + error.message,
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
};
