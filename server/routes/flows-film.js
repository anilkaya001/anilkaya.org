import { HttpError } from "../http.js";

const FILM_PATH = "/assets/img/flows-walkthrough-v2.mp4";
const RANGE = /^bytes=(\d*)-(\d*)$/;

export function flowsFilmRows() {
  return [{
    id: "flows.film",
    path: "/flows/about/film.mp4",
    methods: ["GET", "HEAD"],
    auth: "none",
    handler: async ({ request, env, url }) => {
      if (String(env.FLOWS_FRONT_DOOR || "on").trim().toLowerCase() === "off") throw HttpError.of("not_found");
      const source = await env.ASSETS.fetch(new Request(url.origin + FILM_PATH));
      if (source.status !== 200) throw HttpError.of("not_found");
      const body = await source.arrayBuffer();
      const total = body.byteLength;
      const head = request.method === "HEAD";
      const headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600" };
      const asked = RANGE.exec(request.headers.get("Range") || "");
      if (!asked || (asked[1] === "" && asked[2] === "")) {
        return new Response(head ? null : body, { status: 200, headers: { ...headers, "Content-Length": String(total) } });
      }
      const start = asked[1] === "" ? Math.max(0, total - Number(asked[2])) : Number(asked[1]);
      const end = asked[1] === "" || asked[2] === "" ? total - 1 : Math.min(Number(asked[2]), total - 1);
      if (start >= total || start > end) {
        return new Response(null, { status: 416, headers: { ...headers, "Content-Range": "bytes */" + total } });
      }
      return new Response(head ? null : body.slice(start, end + 1), {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) },
      });
    },
  }];
}
