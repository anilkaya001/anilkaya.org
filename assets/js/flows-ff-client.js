(function () {
  "use strict";
  var UI = window.FlowsUI;
  if (!UI || UI.ffClient) return;

  var PATH_RE = /^\/api\/(ff|flows)\/[A-Za-z0-9/_-]+(\?[^#\s]*)?$/;
  var DEADLINE_MS = 20000;
  var ETAG_MAX = 16;
  var UNWRAP = Object.freeze({ "/api/ff/preview": "preview" });
  var BY_STATUS = Object.freeze({
    401: ["unauthorized", "Authentication required"],
    403: ["forbidden", "Forbidden"],
    404: ["not_found", "Not found"],
    405: ["method_not_allowed", "Method not allowed"],
    413: ["too_large", "Payload is too large"],
    415: ["unsupported_media_type", "Content-Type must be application/json"],
    429: ["rate_limited", "Too many requests; try again shortly."],
    500: ["internal_error", "Internal server error"],
    503: ["service_unavailable", "Service is temporarily unavailable"],
  });
  var etags = new Map();

  function failure(code, message, status, details, retryAfterS) {
    var err = new Error(message);
    err.code = code;
    err.status = status;
    err.details = details;
    err.retryAfterS = retryAfterS;
    return err;
  }

  function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }

  function parse(text) {
    if (text === "") return { ok: true, value: null };
    try { return { ok: true, value: JSON.parse(text) }; } catch (e) { void e; return { ok: false, value: null }; }
  }

  function detailsOf(body, e) {
    if (isObj(e.details)) return e.details;
    var rest = {};
    var keys = Object.keys(body).filter(function (k) { return k !== "error"; });
    keys.forEach(function (k) { rest[k] = body[k]; });
    return keys.length ? rest : null;
  }

  function refused(res, parsed) {
    var body = parsed.ok && isObj(parsed.value) ? parsed.value : {};
    var e = isObj(body.error) ? body.error : {};
    var known = BY_STATUS[res.status];
    var wait = Number(res.headers.get("Retry-After"));
    return failure(
      typeof e.code === "string" && e.code ? e.code : known ? known[0] : "http_" + res.status,
      typeof e.message === "string" && e.message ? e.message : known ? known[1] : "The request failed",
      res.status, detailsOf(body, e), isFinite(wait) && wait > 0 ? wait : null);
  }

  function settle(method, path, res, text, reused) {
    var parsed = parse(text);
    if (!res.ok && !reused) return { error: refused(res, parsed) };
    if (!parsed.ok) return { error: failure("unreadable", "Flows sent an answer that could not be read", res.status, null, null) };
    var guard = UI.fixture;
    if (guard && !guard.host && (guard.nameIn(text) || guard.marked(text))) {
      return { error: failure("fixture", "Flows was sent test data, so nothing is shown", res.status, null, null) };
    }
    var tag = method === "GET" && res.status === 200 ? res.headers.get("ETag") : null;
    if (tag) {
      etags.delete(path);
      etags.set(path, { etag: tag, text: text });
      if (etags.size > ETAG_MAX) etags.delete(etags.keys().next().value);
    }
    var key = UNWRAP[path.split("?")[0]];
    var value = parsed.value;
    return { value: key && isObj(value) && isObj(value[key]) ? value[key] : value };
  }

  function request(method, path, body, opts) {
    var o = opts || {};
    var m = typeof path === "string" ? PATH_RE.exec(path) : null;
    if (!m || (method !== "GET" && m[1] !== "ff")) {
      return Promise.reject(failure("client_path", "The Fire client only reads and writes this site's own Fire routes", 0, null, null));
    }
    var known = method === "GET" ? etags.get(path) || null : null;
    var headers = new Headers({ Accept: "application/json" });
    var given = isObj(o.headers) ? o.headers : {};
    Object.keys(given).forEach(function (k) {
      if (typeof given[k] === "string" && !/^if-none-match$/i.test(k)) headers.set(k, given[k]);
    });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (known) headers.set("If-None-Match", known.etag);
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var init = { method: method, credentials: "same-origin", headers: headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (ctl) init.signal = ctl.signal;
    var ms = typeof o.deadlineMs === "number" && o.deadlineMs > 0 ? o.deadlineMs : DEADLINE_MS;

    return new Promise(function (resolve, reject) {
      var open = true;
      var timer = setTimeout(function () {
        if (!open) return;
        open = false;
        if (ctl) ctl.abort();
        reject(failure("timeout", "Flows did not answer in time", 0, null, null));
      }, ms);
      var close = function (out) {
        if (!open) return;
        open = false;
        clearTimeout(timer);
        if (out.error) reject(out.error);
        else resolve(out.value);
      };
      Promise.resolve().then(function () {
        return window.fetch.call(window, path, init);
      }).then(function (res) {
        if (res.status === 304 && known) return { res: res, text: known.text, reused: true };
        return res.text().then(function (text) { return { res: res, text: text, reused: false }; });
      }).then(function (got) {
        var out;
        try { out = settle(method, path, got.res, got.text, got.reused); } catch (e) { void e; out = { error: failure("unreadable", "Flows sent an answer that could not be read", got.res.status, null, null) }; }
        close(out);
      }, function () {
        close({ error: failure("network", "Flows did not answer", 0, null, null) });
      });
    });
  }

  var send = function (method) {
    return function (path, body, opts) { return request(method, path, body === undefined ? {} : body, opts); };
  };

  var client = Object.freeze({
    get: function (path, opts) { return request("GET", path, undefined, opts); },
    post: send("POST"),
    patch: send("PATCH"),
    put: send("PUT"),
    del: function (path, opts) { return request("DELETE", path, undefined, opts); },
  });
  window.FlowsUI = Object.freeze(Object.assign({}, window.FlowsUI, { ffClient: client }));
})();
