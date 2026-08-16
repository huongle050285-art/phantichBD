// Cache RAM đơn giản, có TTL — dùng chung cho các service gọi API bên ngoài
// (API-Football, The Odds API, football-data.org) để không gọi lại liên tục
// mỗi khi có người mở trang (tiết kiệm quota gói free).
export function createCache(defaultTtlMs) {
  const store = new Map(); // key -> { data, expiresAt }
  const inFlight = new Map(); // key -> Promise (chống gọi trùng khi nhiều request tới cùng lúc lúc cache vừa hết hạn)

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  function set(key, data, ttlMs) {
    store.set(key, { data, expiresAt: Date.now() + (ttlMs ?? defaultTtlMs) });
  }

  // Lấy từ cache nếu còn hạn, không thì gọi loader() — nếu nhiều request cùng
  // gọi lúc cache vừa hết hạn, chỉ 1 request thật sự gọi loader(), các request
  // còn lại đợi chung kết quả (tránh tốn quota khi server vừa "thức dậy" sau khi ngủ).
  async function getOrLoad(key, loader, ttlMs) {
    const cached = get(key);
    if (cached !== undefined) return cached;

    if (inFlight.has(key)) return inFlight.get(key);

    const promise = (async () => {
      try {
        const data = await loader();
        set(key, data, ttlMs);
        return data;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, promise);
    return promise;
  }

  return { get, set, getOrLoad };
}
