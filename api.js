// ============================================================
//  Local API client — thay cho Supabase. Gọi backend Node cùng origin.
// ============================================================
(function () {
  async function req(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && data.error) || res.statusText || "Lỗi máy chủ");
    return data;
  }

  window.api = {
    listWords: () => req("GET", "/api/words"),
    addWord: (fields) => req("POST", "/api/words", fields),
    updateWord: (id, fields) => req("PATCH", "/api/words/" + encodeURIComponent(id), fields),
    deleteWord: (id) => req("DELETE", "/api/words/" + encodeURIComponent(id)),
    bulkAddWords: (rows) => req("POST", "/api/words/bulk", rows),
    resetProgress: () => req("POST", "/api/reset-progress"),
    getMeta: () => req("GET", "/api/meta"),
    putMeta: (meta) => req("PUT", "/api/meta", meta),
    defineWord: (term) => req("POST", "/api/define-word", { term }),
    generatePodcast: (payload) => req("POST", "/api/generate-podcast", payload),
  };
})();
