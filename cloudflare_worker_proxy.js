/**
 * Cloudflare Worker - WPS AirScript 2.0 在线反向代理转发脚本
 * 
 * 用途：
 * 当公司内网/防火墙限制或封禁 www.kdocs.cn 时，通过 Cloudflare Worker 免费转发 API 请求。
 * 
 * 部署步骤：
 * 1. 登录 Cloudflare 控制台 (https://dash.cloudflare.com)
 * 2. 进入「Compute (Workers & Pages)」-> 点击「Create Application」->「Create Worker」
 * 3. 命名你的 Worker（如 wps-proxy），点击 Deploy
 * 4. 进入 Edit code，将本文件代码完整覆盖粘贴进去，点击「Deploy」保存
 * 5. 复制 Worker 分配的域名（例如 https://wps-proxy.yourname.workers.dev）
 * 6. 在本地 .env 中配置：WPS_BASE_URL="https://wps-proxy.yourname.workers.dev" 即可！
 */

export default {
  async fetch(request, env, ctx) {
    const targetHost = "www.kdocs.cn";
    const url = new URL(request.url);

    // 处理跨域预检请求 (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, AirScript-Token, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
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

    // 构建代理转发请求
    const proxyRequest = new Request(url.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: "follow",
    });

    try {
      const response = await fetch(proxyRequest);

      // 返回响应并附加 CORS 头
      const modifiedResponse = new Response(response.body, response);
      modifiedResponse.headers.set("Access-Control-Allow-Origin", "*");
      modifiedResponse.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, AirScript-Token, Authorization"
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
