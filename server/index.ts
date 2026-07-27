import indexHtml from "../dist/client/index.html?raw";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (url.pathname.includes(".") && !acceptsHtml) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(request.method === "HEAD" ? null : indexHtml, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  },
};
